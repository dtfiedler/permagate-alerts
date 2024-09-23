import { logger } from './logger.js';
import { knex } from './db/knexfile.js';

logger.info('Migrating database...');
knex.migrate
  .latest()
  .then(() => {
    logger.info('Migration successful!');
    process.exit(0);
  })
  .catch((error: unknown) => {
    logger.error('Migration failed:', error);
    process.exit(1);
  });
