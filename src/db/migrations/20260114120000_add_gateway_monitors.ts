import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Gateway monitors table - main configuration
  await knex.schema.createTable('gateway_monitors', (table) => {
    table.increments('id').primary();
    table
      .integer('subscriber_id')
      .notNullable()
      .references('id')
      .inTable('subscribers')
      .onDelete('CASCADE');
    table.text('fqdn').notNullable(); // Gateway domain (e.g., ar-io.dev)
    table.boolean('enabled').notNullable().defaultTo(true);
    table.integer('check_interval_minutes').notNullable().defaultTo(5);
    table.integer('failure_threshold').notNullable().defaultTo(3);
    table.text('current_status').notNullable().defaultTo('unknown'); // 'unknown' | 'healthy' | 'unhealthy'
    table.integer('consecutive_failures').notNullable().defaultTo(0);
    table.timestamp('last_check_at');
    table.timestamp('last_alert_sent_at');
    table.timestamp('last_recovery_sent_at');
    table.boolean('notify_email').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // One monitor per gateway per subscriber
    table.unique(['subscriber_id', 'fqdn']);
    // Index for efficient cron queries
    table.index(['enabled', 'last_check_at']);
  });

  // Gateway healthcheck history table - stores results (14-day retention)
  await knex.schema.createTable('gateway_healthcheck_history', (table) => {
    table.increments('id').primary();
    table
      .integer('monitor_id')
      .notNullable()
      .references('id')
      .inTable('gateway_monitors')
      .onDelete('CASCADE');
    table.text('status').notNullable(); // 'success' | 'failed'
    table.integer('response_time_ms'); // null if failed
    table.integer('status_code'); // HTTP status code, null if connection failed
    table.text('error_message'); // Error details if failed
    table.timestamp('checked_at').notNullable().defaultTo(knex.fn.now());

    // Index for history queries
    table.index(['monitor_id', 'checked_at']);
  });

  // Gateway monitor webhooks table - links monitors to notification webhooks
  await knex.schema.createTable('gateway_monitor_webhooks', (table) => {
    table.increments('id').primary();
    table
      .integer('monitor_id')
      .notNullable()
      .references('id')
      .inTable('gateway_monitors')
      .onDelete('CASCADE');
    table
      .integer('webhook_id')
      .notNullable()
      .references('id')
      .inTable('webhooks')
      .onDelete('CASCADE');
    table.boolean('notify_on_down').notNullable().defaultTo(true);
    table.boolean('notify_on_recovery').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    // One link per monitor/webhook pair
    table.unique(['monitor_id', 'webhook_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('gateway_monitor_webhooks');
  await knex.schema.dropTableIfExists('gateway_healthcheck_history');
  await knex.schema.dropTableIfExists('gateway_monitors');
}
