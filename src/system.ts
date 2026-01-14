import cron from 'node-cron';
import { SqliteDatabase } from './db/sqlite.js';
import { knex } from './db/knexfile.js';
import { logger } from './logger.js';
import * as config from './config.js';
import { EventProcessor } from './processor.js';
import Arweave from 'arweave';
import { GQLEventPoller } from './gql.js';
import { ARIO, ARIO_MAINNET_PROCESS_ID } from '@ar.io/sdk';
import {
  CompositeNotificationProvider,
  EmailNotificationProvider,
  TwitterNotificationProvider,
  WebhookNotificationProvider,
} from './notifications/index.js';

import { CachedArio } from './ario.js';
import { connect } from '@permaweb/aoconnect';
import { SESEmailProvider } from './email/ses.js';
import { CoinGeckoService } from './prices/coin-gecko.js';
import { ArNSSyncService, ArNSExpirationProcessor } from './arns/index.js';

export const ario = new CachedArio({
  ario: ARIO.mainnet(),
  logger,
});
export const ao = connect({
  CU_URL: config.cuUrl,
  MODE: 'legacy',
});

export const db = new SqliteDatabase({
  knex,
  logger,
});

export const priceService = new CoinGeckoService({
  ttlSeconds: config.priceServiceTTLSeconds,
});

// trigger initial price fetch
priceService.getPrice();

// Initialize individual notification providers
export const emailProvider =
  config.awsAccessKeyId &&
  config.awsSecretAccessKey &&
  config.awsRegion &&
  config.awsFromEmail
    ? new SESEmailProvider({
        logger: logger,
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey,
        region: config.awsRegion,
        from: config.awsFromEmail,
      })
    : undefined;

// Email notification provider
const emailNotifier = emailProvider
  ? new EmailNotificationProvider({
      emailProvider: emailProvider,
      db,
      logger,
      enabled: !config.disableEmails,
    })
  : undefined;

// Twitter notification provider
const twitterNotifier = config.twitterBearerToken
  ? new TwitterNotificationProvider({
      bearerToken: config.twitterBearerToken,
      logger,
      enabled: config.enableTwitterNotifications,
    })
  : undefined;

// Webhook notification provider (database-stored webhooks with type-based formatting)
// Supports 'custom', 'discord', and 'slack' webhook types
const webhookNotifier = new WebhookNotificationProvider({
  db,
  logger,
  enabled: true,
});

// Create composite notification provider with all enabled providers
export const notificationProvider = new CompositeNotificationProvider({
  providers: [
    ...(emailNotifier ? [emailNotifier] : []),
    ...(twitterNotifier ? [twitterNotifier] : []),
    webhookNotifier,
  ],
  logger,
});

export const arweave = new Arweave({
  host: config.gatewayHost,
  port: 443,
  protocol: 'https',
});

export const processor = new EventProcessor({
  db,
  logger,
  notificationProvider,
});

export const eventGqlPoller = new GQLEventPoller({
  ao,
  logger,
  processId: config.arioProcessId || ARIO_MAINNET_PROCESS_ID,
  processor,
  gqlUrl: config.gqlUrl,
  skipToCurrentBlock: config.skipToCurrentBlock,
  db: db,
  arweave: arweave,
  authorities: ['fcoN_xJeisVsPXA-trzVAuIiqO3ydLQxM-L4XbrQKzY'],
});

// every 1 minute, check GQL for new events
export const eventGqlCron = config.disableEventProcessing
  ? {
      start: () => {
        logger.info('Event processing is disabled');
      },
      stop: () => {
        logger.info('Event processing is disabled');
      },
    }
  : cron.schedule(
      '*/1 * * * *',
      async () => {
        await eventGqlPoller.fetchAndProcessEvents();
        // await eventGqlPoller.fetchAndProcessTriggers();
      },
      {
        runOnInit: true,
      },
    );

// ArNS Name Expiration Tracking
export const arnsSyncService = new ArNSSyncService({
  ario: ARIO.mainnet(),
  db,
  logger,
  resolverBaseUrl: config.arnsResolverUrl,
});

export const arnsExpirationProcessor = new ArNSExpirationProcessor({
  db,
  logger,
  notificationProvider,
});

// Daily sync at 00:00:00 UTC - fetch all leased ArNS names
export const arnsSyncCron = config.disableArnsSync
  ? {
      start: () => {
        logger.info('ArNS sync is disabled');
      },
      stop: () => {
        logger.info('ArNS sync is disabled');
      },
    }
  : cron.schedule(
      '0 0 * * *', // Every day at midnight UTC
      async () => {
        logger.info('Running daily ArNS sync');
        await arnsSyncService.syncAllArNSNames();
      },
      {
        scheduled: true,
        timezone: 'UTC',
      },
    );

// Daily check for expiring ArNS names (runs 5 minutes after sync)
export const arnsExpirationCron = config.disableArnsSync
  ? {
      start: () => {
        logger.info('ArNS expiration check is disabled');
      },
      stop: () => {
        logger.info('ArNS expiration check is disabled');
      },
    }
  : cron.schedule(
      '5 0 * * *', // Every day at 00:05 UTC (5 minutes after sync)
      async () => {
        logger.info('Checking for ArNS name expirations');
        await arnsExpirationProcessor.processExpiringNames();
      },
      {
        scheduled: true,
        timezone: 'UTC',
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
  arnsSyncCron.stop();
  arnsExpirationCron.stop();
  process.exit(0);
};
