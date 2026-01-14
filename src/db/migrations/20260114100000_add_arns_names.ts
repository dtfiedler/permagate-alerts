import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ArNS names table - stores leased ArNS name data for expiration tracking
  await knex.schema.createTable('arns_names', (table) => {
    table.increments('id').primary();
    table.text('name').notNullable().unique(); // The ArNS name
    table.text('process_id').notNullable(); // processId from ArNS record
    table.text('owner').notNullable(); // Owner wallet address (from resolver)
    table.text('root_tx_id'); // Root transaction ID
    table.bigInteger('end_timestamp').notNullable(); // Expiration timestamp
    table.bigInteger('start_timestamp').notNullable();
    table.timestamp('last_synced_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Indexes for efficient querying
    table.index('owner');
    table.index('end_timestamp');
  });

  // ArNS expiration notifications table - tracks sent notifications (prevent duplicates)
  await knex.schema.createTable('arns_expiration_notifications', (table) => {
    table.increments('id').primary();
    table.text('name').notNullable();
    table.text('notification_type').notNullable(); // 'grace_period_start' | 'grace_period_ending'
    table.bigInteger('end_timestamp').notNullable(); // The end_timestamp at time of notification
    table.timestamp('sent_at').notNullable().defaultTo(knex.fn.now());

    // Unique constraint: one notification per type per name per end_timestamp
    table.unique(['name', 'notification_type', 'end_timestamp']);
  });

  // ArNS name subscriptions table - subscribe to specific names
  await knex.schema.createTable('arns_name_subscriptions', (table) => {
    table.increments('id').primary();
    table
      .integer('subscriber_id')
      .notNullable()
      .references('id')
      .inTable('subscribers')
      .onDelete('CASCADE');
    table.text('name').notNullable(); // Specific ArNS name to watch
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['subscriber_id', 'name']);
    table.index('name');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('arns_name_subscriptions');
  await knex.schema.dropTableIfExists('arns_expiration_notifications');
  await knex.schema.dropTableIfExists('arns_names');
}
