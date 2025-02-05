import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('subscribers', (table) => {
    table.increments('id').primary();
    table.string('email').notNullable().unique();
    table
      .text('events')
      .notNullable()
      .defaultTo(
        JSON.stringify([
          'buy-record-notice',
          'epoch-distribution-notice',
          'save-observations-notice',
        ]),
      );
    table.timestamps(true, true);
  });

  // create another table that has columns subscriber_id, wallet_address, and created_at and subscriber_id is a foreign key to the subscribers table and key must be unique on subscriber_id and wallet_address
  await knex.schema.createTable('subscriber_wallets', (table) => {
    table.increments('id').primary();
    table
      .integer('subscriber_id')
      .notNullable()
      .references('id')
      .inTable('subscribers');
    table.string('wallet_address').notNullable();
    table.timestamps(true, true);
    table.unique(['subscriber_id', 'wallet_address']);
  });

  // create a table to track incoming events
  await knex.schema.createTable('events', (table) => {
    table.increments('id').primary();
    table.string('event_type').notNullable();
    table.text('event_data').notNullable();
    table.integer('nonce').notNullable().unique();
    table.boolean('emails_sent').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('processed_at');
    table.index('event_type');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Drop the 'alerts' table
  await knex.schema.dropTableIfExists('events');

  // Drop the 'subscriber_wallets' table
  await knex.schema.dropTableIfExists('subscriber_wallets');

  // Drop the 'subscribers' table
  await knex.schema.dropTableIfExists('subscribers');
}
