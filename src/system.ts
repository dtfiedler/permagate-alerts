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
  SlackNotificationProvider,
  TwitterNotificationProvider,
  WebhookNotificationProvider,
  WebhookRecipient,
} from './notifications/index.js';
import { DiscordNotificationProvider } from './notifications/discord.js';

import { CachedArio } from './ario.js';
import { connect } from '@permaweb/aoconnect';
import { SESEmailProvider } from './email/ses.js';
import { CoinGeckoService } from './prices/coin-gecko.js';

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

// Slack notification provider
const slackNotifier = config.slackWebhookUrl
  ? new SlackNotificationProvider({
      webhookUrl: config.slackWebhookUrl,
      logger,
      enabled: config.enableSlackNotifications,
    })
  : undefined;

// Discord notification provider
const discordNotifier = config.discordWebhookUrls.length > 0
  ? new DiscordNotificationProvider({
      webhookUrls: config.discordWebhookUrls,
      logger,
      enabled: config.enableDiscordNotifications,
    })
  : undefined;

// Webhook notification provider
const webhookEndpoints: WebhookRecipient[] = Array.isArray(
  config.webhookEndpoints,
)
  ? config.webhookEndpoints
  : [];

const webhookNotifier = new WebhookNotificationProvider({
  endpoints: webhookEndpoints,
  logger,
  enabled: webhookEndpoints.length > 0,
});

// Create composite notification provider with all enabled providers
export const notificationProvider = new CompositeNotificationProvider({
  providers: [
    ...(emailNotifier ? [emailNotifier] : []),
    ...(twitterNotifier ? [twitterNotifier] : []),
    ...(slackNotifier ? [slackNotifier] : []),
    ...(discordNotifier ? [discordNotifier] : []),
    ...(webhookNotifier ? [webhookNotifier] : []),
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
