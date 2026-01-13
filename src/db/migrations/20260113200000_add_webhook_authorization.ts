import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('webhooks', (table) => {
    table.text('authorization'); // Optional authorization header for custom webhooks
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('webhooks', (table) => {
    table.dropColumn('authorization');
  });
}
