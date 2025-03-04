import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // set defaults to the events table
  await knex.transaction(async (tx) => {
    // rename column to events_old
    await tx.raw('ALTER TABLE subscribers RENAME COLUMN events TO events_old');
    // add the new events column
    await tx.raw(
      "ALTER TABLE subscribers ADD COLUMN events TEXT DEFAULT 'buy-name-notice,epoch-distribution-notice,join-network-notice,leave-network-notice'",
    );

    // import the old events data into the new events column
    await tx.raw(
      'UPDATE subscribers SET events = events_old WHERE events_old IS NOT NULL',
    );

    // drop the old events column
    await tx.raw('ALTER TABLE subscribers DROP COLUMN events_old');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.transaction(async (tx) => {
    // Use raw query to handle the column operations
    // await tx.raw('ALTER TABLE subscribers DROP COLUMN events IF EXISTS');
    await tx.raw('ALTER TABLE subscribers RENAME COLUMN events TO events_old');
    await tx.raw(
      "ALTER TABLE subscribers ADD COLUMN events TEXT DEFAULT 'buy-name-notice,epoch-distribution-notice,join-network-notice,leave-network-notice'",
    );

    // import the old events data into the new events column
    await tx.raw(
      'UPDATE subscribers SET events = events_old WHERE events_old IS NOT NULL',
    );

    // drop the old events column
    await tx.raw('ALTER TABLE subscribers DROP COLUMN events_old');
  });
}
