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
          'name-expiration-notice',
          'distribution-notice',
          'save-observations-notice',
        ]),
      );
    table.timestamps(true, true);
  });

  // Create a table to track incoming alerts
  await knex.schema.createTable('alerts', (table) => {
    table.increments('id').primary();
    table.string('event_type').notNullable();
    table.jsonb('event_data').notNullable();
    table.integer('nonce').notNullable().unique();
    table.boolean('emails_sent').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('processed_at');
    table.index('event_type');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Drop the 'alerts' table
  await knex.schema.dropTableIfExists('alerts');

  // Drop the 'subscribers' table
  await knex.schema.dropTableIfExists('subscribers');
}
