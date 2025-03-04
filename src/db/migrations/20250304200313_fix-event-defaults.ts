import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // set defaults to the events table
  await knex.schema.alterTable('subscribers', async (table) => {
    // drop the existing events column
    await table.renameColumn('events', 'events_old');
    // add the new events column
    await table
      .text('events')
      .notNullable()
      .defaultTo(
        JSON.stringify([
          'buy-name-notice',
          'epoch-distribution-notice',
          'join-network-notice',
          'leave-network-notice',
        ]),
      );

    // import the old events data into the new events column
    await knex('subscribers')
      .whereNotNull('events_old')
      .update({ events: knex.raw('events_old') });

    // drop the old events column
    await table.dropColumn('events_old');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('subscribers', async (table) => {
    // rename the events_old column to events
    await table.renameColumn('events_old', 'events');
    // add the old events column
    await table
      .text('events')
      .notNullable()
      .defaultTo(
        JSON.stringify([
          'buy-record-notice',
          'epoch-distribution-notice',
          'save-observations-notice',
        ]),
      );

    // import the old events data into the new events column
    await knex('subscribers')
      .whereNotNull('events_old')
      .update({ events: knex.raw('events_old') });

    // drop the old events column
    await table.dropColumn('events_old');
  });
}
