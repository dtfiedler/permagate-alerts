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
import {
  GatewayHealthcheckService,
  GatewayMonitorProcessor,
  MonitorAlertData,
} from './monitoring/index.js';
import { Webhook } from './db/schema.js';

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
  enabled: !config.disableWebhookNotifications,
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

// Gateway Monitoring
export const gatewayHealthcheckService = new GatewayHealthcheckService({
  logger,
  timeoutMs: config.gatewayHealthcheckTimeoutMs,
});

/**
 * Send a gateway monitoring webhook notification.
 */
async function sendGatewayMonitorWebhook(
  webhook: Webhook,
  alertType: string,
  data: MonitorAlertData,
): Promise<void> {
  if (config.disableWebhookNotifications) {
    logger.debug('Webhook notifications are disabled, skipping gateway monitor webhook');
    return;
  }

  const payload = formatGatewayMonitorWebhookPayload(webhook.type, alertType, data);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (webhook.authorization) {
    headers['Authorization'] = webhook.authorization;
  }

  const response = await fetch(webhook.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
  }

  // Update status in background
  db.updateWebhookStatus(webhook.id, 'success').catch((err) => {
    logger.error('Failed to update webhook status', {
      webhookId: webhook.id,
      error: err.message,
    });
  });
}

function formatGatewayMonitorWebhookPayload(
  type: string,
  alertType: string,
  data: MonitorAlertData,
): Record<string, unknown> {
  const isDown = alertType === 'gateway-down';
  const emoji = isDown ? '🔴' : '🟢';
  const status = isDown ? 'DOWN' : 'UP';
  const header = `${emoji} Gateway ${data.fqdn} is ${status}`;

  switch (type) {
    case 'discord': {
      const fields = [
        `**Gateway**: ${data.fqdn}`,
        `**Status**: ${data.currentStatus}`,
        `**Last Check**: ${data.lastCheckAt}`,
      ];
      if (isDown) {
        fields.push(`**Consecutive Failures**: ${data.consecutiveFailures}`);
        if (data.errorMessage) {
          fields.push(`**Error**: ${data.errorMessage}`);
        }
      } else if (data.responseTimeMs !== null) {
        fields.push(`**Response Time**: ${data.responseTimeMs}ms`);
      }
      return {
        content: `# ${header}\n\n${fields.join('\n')}`,
      };
    }
    case 'slack': {
      const fields = [
        `*Gateway*: ${data.fqdn}`,
        `*Status*: ${data.currentStatus}`,
        `*Last Check*: ${data.lastCheckAt}`,
      ];
      if (isDown) {
        fields.push(`*Consecutive Failures*: ${data.consecutiveFailures}`);
        if (data.errorMessage) {
          fields.push(`*Error*: ${data.errorMessage}`);
        }
      } else if (data.responseTimeMs !== null) {
        fields.push(`*Response Time*: ${data.responseTimeMs}ms`);
      }
      return {
        text: header,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: header,
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: fields.join('\n'),
            },
          },
        ],
      };
    }
    case 'custom':
    default:
      return {
        alertType,
        gateway: data.fqdn,
        status: data.currentStatus,
        consecutiveFailures: data.consecutiveFailures,
        lastCheckAt: data.lastCheckAt,
        responseTimeMs: data.responseTimeMs,
        errorMessage: data.errorMessage,
      };
  }
}

/**
 * Send a gateway monitoring email notification.
 */
async function sendGatewayMonitorEmail(
  email: string,
  alertType: string,
  data: MonitorAlertData,
): Promise<void> {
  if (!emailProvider) {
    logger.warn('Email provider not configured, skipping gateway monitor email');
    return;
  }

  const isDown = alertType === 'gateway-down';
  const emoji = isDown ? '🔴' : '🟢';
  const status = isDown ? 'DOWN' : 'UP';
  const subject = `${emoji} Gateway ${data.fqdn} is ${status}`;

  let body = `Gateway: ${data.fqdn}\nStatus: ${data.currentStatus}\nLast Check: ${data.lastCheckAt}\n`;
  if (isDown) {
    body += `Consecutive Failures: ${data.consecutiveFailures}\n`;
    if (data.errorMessage) {
      body += `Error: ${data.errorMessage}\n`;
    }
  } else if (data.responseTimeMs !== null) {
    body += `Response Time: ${data.responseTimeMs}ms\n`;
  }

  await emailProvider.sendRawEmail({
    to: [email],
    subject,
    text: body,
  });
}

export const gatewayMonitorProcessor = new GatewayMonitorProcessor({
  db,
  logger,
  healthcheckService: gatewayHealthcheckService,
  sendWebhook: sendGatewayMonitorWebhook,
  sendEmail: sendGatewayMonitorEmail,
});

// Gateway monitor cron - runs every minute, checks monitors due for healthcheck
export const gatewayMonitorCron = config.disableGatewayMonitoring
  ? {
      start: () => {
        logger.info('Gateway monitoring is disabled');
      },
      stop: () => {
        logger.info('Gateway monitoring is disabled');
      },
    }
  : cron.schedule(
      '*/1 * * * *', // Every minute
      async () => {
        await gatewayMonitorProcessor.processMonitors();
      },
      {
        scheduled: true,
      },
    );

// Healthcheck history pruning cron - runs daily at 02:00 UTC
export const healthcheckHistoryPruneCron = config.disableGatewayMonitoring
  ? {
      start: () => {
        logger.info('Healthcheck history pruning is disabled');
      },
      stop: () => {
        logger.info('Healthcheck history pruning is disabled');
      },
    }
  : cron.schedule(
      '0 2 * * *', // Every day at 02:00 UTC
      async () => {
        logger.info('Pruning old healthcheck history');
        await gatewayMonitorProcessor.pruneOldHistory(14);
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
  gatewayMonitorCron.stop();
  healthcheckHistoryPruneCron.stop();
  process.exit(0);
};
