import cron from 'node-cron';
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
      logger,
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

// create a daily cron for 8 AM local time (EST)
export const dailyDigestCron = cron.schedule('* 8 * * *', () => {
  processor.processDailyDigest();
});

process.on('unhandledRejection', (error: any) => {
  logger.error('Unhandled Rejection at:', error);
});

process.on('uncaughtException', (error: unknown) => {
  logger.error('Uncaught Exception thrown', error);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, exiting...');
  shutdown();
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, exiting...');
  shutdown();
});

export const shutdown = () => {
  dailyDigestCron.stop();
  process.exit(0);
};
