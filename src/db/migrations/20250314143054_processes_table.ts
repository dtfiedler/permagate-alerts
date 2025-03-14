import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('processes', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('process_id').notNullable().unique();
    table.string('events').notNullable().defaultTo('');
    table.timestamps(true, true);
  });

  // add qNvAoz0TgcH7DMg8BCVn8jF32QH5L6T29VjHxhHqqGE to processes table
  await knex('processes').insert({
    name: 'AR.IO Network',
    process_id: 'qNvAoz0TgcH7DMg8BCVn8jF32QH5L6T29VjHxhHqqGE',
    events:
      'buy-name-notice,epoch-distribution-notice,join-network-notice,leave-network-notice,updated-demand-factor-notice,epoch-created-notice',
  });

  // create subscriber_process table
  await knex.schema.createTable('subscriber_processes', (table) => {
    table.increments('id').primary();
    table.integer('subscriber_id').notNullable().references('subscribers.id');
    table
      .integer('process_id')
      .notNullable()
      .references('processes.process_id');
    table.string('event_type').notNullable();
    table.string('address').defaultTo(null);
    table.unique(['subscriber_id', 'process_id', 'event_type', 'address']);
    table.timestamps(true, true);
  });

  const subscribers = await knex('subscribers').select('id', 'events');
  const processes = await knex('processes').select('id', 'process_id');
  for (const subscriber of subscribers) {
    for (const process of processes) {
      for (const eventType of subscriber.events.split(',')) {
        await knex('subscriber_processes').insert({
          subscriber_id: subscriber.id,
          process_id: process.process_id,
          event_type: eventType.trim(),
        });
      }
    }
  }

  // then drop the events column from subscribers table
  await knex.raw('ALTER TABLE subscribers DROP COLUMN events');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('subscriber_processes');
  await knex.schema.dropTable('processes');
  await knex.schema.alterTable('subscribers', (table) => {
    table
      .string('events')
      .notNullable()
      .defaultTo(
        'buy-name-notice,epoch-distribution-notice,join-network-notice,leave-network-notice',
      );
  });
}
