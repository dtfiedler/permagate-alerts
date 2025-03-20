import cron from 'node-cron';
import { SqliteDatabase } from './db/sqlite.js';
import { knex } from './db/knexfile.js';
import { logger } from './logger.js';
import * as config from './config.js';
import { MailgunEmailProvider } from './email/mailgun.js';
import { EventProcessor } from './processor.js';
import Arweave from 'arweave';
import { GQLEventPoller } from './gql.js';
import { ARIO_MAINNET_PROCESS_ID } from '@ar.io/sdk';

// TODO: replace with composite provider that sends to all EventProviders
export const notifier = config.mailgunApiKey
  ? new MailgunEmailProvider({
      apiKey: config.mailgunApiKey!,
      domain: config.mailgunDomain!,
      from: config.mailgunFromEmail!,
      logger,
    })
  : undefined;

export const arweave = new Arweave({
  host: config.gatewayHost,
  port: 443,
  protocol: 'https',
});

export const db = new SqliteDatabase({
  knex,
  logger,
});

export const processor = new EventProcessor({
  db,
  logger,
  notifier,
});

export const eventGqlPoller = new GQLEventPoller({
  logger,
  processId: config.arioProcessId || ARIO_MAINNET_PROCESS_ID,
  processor,
  gqlUrl: config.gqlUrl,
  skipToCurrentBlock: config.skipToCurrentBlock,
  db: db,
  arweave: Arweave.init({
    host: 'arweave.net',
    port: 443,
    protocol: 'https',
  }),
  authorities: ['fcoN_xJeisVsPXA-trzVAuIiqO3ydLQxM-L4XbrQKzY'],
});

// every 1 minute, check GQL for new events
export const eventGqlCron = cron.schedule(
  '*/1 * * * *',
  async () => {
    await eventGqlPoller.fetchAndProcessEvents();
    await eventGqlPoller.fetchAndProcessTriggers();
  },
  {
    runOnInit: true,
  },
);

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
  eventGqlCron.stop();
  process.exit(0);
};
