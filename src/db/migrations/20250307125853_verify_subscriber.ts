import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('subscribers', async (table) => {
    table.boolean('verified').defaultTo(false);

    // backfill the verified to true for all current subscribers
    for (const subscriber of await knex('subscribers').select('*')) {
      await knex('subscribers').where('id', subscriber.id).update({
        verified: true,
      });
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('subscribers', (table) => {
    table.dropColumn('verified');
  });
}
