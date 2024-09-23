import { SqliteDatabase } from './db/sqlite.js';
import { knex } from './db/knexfile.js';
import { logger } from './logger.js';
import * as config from './config.js';
import { MailgunEmailProvider } from './email/mailgun.js';
import { EventProcessor } from './processor.js';

// TODO: replace with composite provider that sends to all EventProviders
export const notifier = config.mailgunApiKey
  ? new MailgunEmailProvider({
      apiKey: config.mailgunApiKey!,
      domain: config.mailgunDomain!,
      from: config.mailgunFromEmail!,
    })
  : undefined;

export const db = new SqliteDatabase({
  knex,
  logger,
});

export const processor = new EventProcessor({
  db,
  logger,
  notifier,
});

process.on('unhandledRejection', (error: any) => {
  logger.error('Unhandled Rejection at:', error);
});

process.on('uncaughtException', (error: unknown) => {
  logger.error('Uncaught Exception thrown', error);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, exiting...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, exiting...');
  process.exit(0);
});
