import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Webhooks table - stores webhook endpoints
  await knex.schema.createTable('webhooks', (table) => {
    table.increments('id').primary();
    table
      .integer('subscriber_id')
      .notNullable()
      .references('id')
      .inTable('subscribers')
      .onDelete('CASCADE');
    table.text('url').notNullable();
    table.text('description');
    table.text('type').notNullable().defaultTo('custom'); // 'custom' | 'discord' | 'slack'
    table.boolean('active').defaultTo(true);
    table.text('last_status'); // 'success' | 'failed' | null
    table.text('last_error');
    table.text('last_triggered_at');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.unique(['subscriber_id', 'url']); // one webhook per URL per subscriber
  });

  // Webhook events table - connects webhooks to event types (many-to-many)
  await knex.schema.createTable('webhook_events', (table) => {
    table.increments('id').primary();
    table
      .integer('webhook_id')
      .notNullable()
      .references('id')
      .inTable('webhooks')
      .onDelete('CASCADE');
    table.text('event_type').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.unique(['webhook_id', 'event_type']); // one entry per webhook/event combo
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('webhook_events');
  await knex.schema.dropTable('webhooks');
}
