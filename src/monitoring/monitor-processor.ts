import { Logger } from 'winston';
import { SqliteDatabase } from '../db/sqlite.js';
import { GatewayHealthcheckService, HealthcheckResult } from './healthcheck.js';
import { GatewayMonitor, Webhook } from '../db/schema.js';

interface MonitorAlertData {
  fqdn: string;
  currentStatus: 'healthy' | 'unhealthy';
  consecutiveFailures: number;
  lastCheckAt: string;
  responseTimeMs: number | null;
  errorMessage: string | null;
}

interface GatewayMonitorProcessorOptions {
  db: SqliteDatabase;
  logger: Logger;
  healthcheckService: GatewayHealthcheckService;
  sendWebhook: (webhook: Webhook, alertType: string, data: MonitorAlertData) => Promise<void>;
  sendEmail: (email: string, alertType: string, data: MonitorAlertData) => Promise<void>;
}

/**
 * Processor to check gateway monitors and send alerts.
 * Called by the cron job every minute, processes monitors due for check.
 */
export class GatewayMonitorProcessor {
  private db: SqliteDatabase;
  private logger: Logger;
  private healthcheckService: GatewayHealthcheckService;
  private sendWebhook: (webhook: Webhook, alertType: string, data: MonitorAlertData) => Promise<void>;
  private sendEmail: (email: string, alertType: string, data: MonitorAlertData) => Promise<void>;

  constructor(options: GatewayMonitorProcessorOptions) {
    this.db = options.db;
    this.logger = options.logger.child({ module: 'GatewayMonitorProcessor' });
    this.healthcheckService = options.healthcheckService;
    this.sendWebhook = options.sendWebhook;
    this.sendEmail = options.sendEmail;
  }

  /**
   * Process all monitors due for healthcheck.
   */
  async processMonitors(): Promise<void> {
    this.logger.info('Processing gateway monitors');

    try {
      const monitors = await this.db.getMonitorsDueForCheck();
      this.logger.debug('Found monitors due for check', {
        count: monitors.length,
      });

      // Process monitors in parallel (with some concurrency limit)
      const batchSize = 10;
      for (let i = 0; i < monitors.length; i += batchSize) {
        const batch = monitors.slice(i, i + batchSize);
        await Promise.all(batch.map((monitor) => this.processMonitor(monitor)));
      }

      this.logger.info('Completed processing gateway monitors', {
        processed: monitors.length,
      });
    } catch (error) {
      this.logger.error('Error processing gateway monitors', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Process a single monitor.
   */
  private async processMonitor(monitor: GatewayMonitor): Promise<void> {
    try {
      // Perform healthcheck
      const result = await this.healthcheckService.checkGateway(monitor.fqdn);

      // Store in history
      await this.db.addHealthcheckHistory(monitor.id, result);

      // Get previous status before update
      const previousStatus = monitor.current_status;
      const wasUnhealthy = previousStatus === 'unhealthy';
      const hadAlertedDown = Boolean(
        monitor.last_alert_sent_at &&
          (!monitor.last_recovery_sent_at ||
            monitor.last_alert_sent_at > monitor.last_recovery_sent_at),
      );

      // Update monitor status
      const updatedMonitor = await this.db.updateMonitorAfterCheck(
        monitor.id,
        result,
      );

      if (!updatedMonitor) {
        return;
      }

      // Check if we need to send alerts
      if (result.success) {
        // Gateway is healthy - check if we need to send recovery alert
        if (wasUnhealthy && hadAlertedDown) {
          await this.sendRecoveryAlert(updatedMonitor, result);
        }
      } else {
        // Gateway failed - check if we crossed the threshold
        if (
          updatedMonitor.consecutive_failures >= monitor.failure_threshold &&
          monitor.consecutive_failures < monitor.failure_threshold
        ) {
          // Just crossed threshold, send alert
          await this.sendDownAlert(updatedMonitor, result);
        }
      }
    } catch (error) {
      this.logger.error('Error processing monitor', {
        monitorId: monitor.id,
        fqdn: monitor.fqdn,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Send "gateway down" alert via webhooks and email.
   */
  private async sendDownAlert(
    monitor: GatewayMonitor,
    result: HealthcheckResult,
  ): Promise<void> {
    this.logger.info('Sending gateway down alert', {
      monitorId: monitor.id,
      fqdn: monitor.fqdn,
      consecutiveFailures: monitor.consecutive_failures,
    });

    const alertData: MonitorAlertData = {
      fqdn: monitor.fqdn,
      currentStatus: 'unhealthy',
      consecutiveFailures: monitor.consecutive_failures,
      lastCheckAt: new Date().toISOString(),
      responseTimeMs: result.responseTimeMs,
      errorMessage: result.errorMessage,
    };

    // Send to webhooks
    const webhooks = await this.db.getWebhooksForMonitorAlert(monitor.id, 'down');
    for (const webhook of webhooks) {
      try {
        await this.sendWebhook(webhook, 'gateway-down', alertData);
      } catch (error) {
        this.logger.error('Failed to send webhook alert', {
          webhookId: webhook.id,
          error: (error as Error).message,
        });
      }
    }

    // Send email if enabled
    if (monitor.notify_email) {
      const subscriber = await this.db.getSubscriberForMonitor(monitor.id);
      if (subscriber?.email) {
        try {
          await this.sendEmail(subscriber.email, 'gateway-down', alertData);
        } catch (error) {
          this.logger.error('Failed to send email alert', {
            email: subscriber.email,
            error: (error as Error).message,
          });
        }
      }
    }

    // Mark alert as sent
    await this.db.markMonitorAlertSent(monitor.id);
  }

  /**
   * Send "gateway recovered" alert via webhooks and email.
   */
  private async sendRecoveryAlert(
    monitor: GatewayMonitor,
    result: HealthcheckResult,
  ): Promise<void> {
    this.logger.info('Sending gateway recovery alert', {
      monitorId: monitor.id,
      fqdn: monitor.fqdn,
    });

    const alertData: MonitorAlertData = {
      fqdn: monitor.fqdn,
      currentStatus: 'healthy',
      consecutiveFailures: 0,
      lastCheckAt: new Date().toISOString(),
      responseTimeMs: result.responseTimeMs,
      errorMessage: null,
    };

    // Send to webhooks
    const webhooks = await this.db.getWebhooksForMonitorAlert(monitor.id, 'recovery');
    for (const webhook of webhooks) {
      try {
        await this.sendWebhook(webhook, 'gateway-recovered', alertData);
      } catch (error) {
        this.logger.error('Failed to send webhook recovery alert', {
          webhookId: webhook.id,
          error: (error as Error).message,
        });
      }
    }

    // Send email if enabled
    if (monitor.notify_email) {
      const subscriber = await this.db.getSubscriberForMonitor(monitor.id);
      if (subscriber?.email) {
        try {
          await this.sendEmail(subscriber.email, 'gateway-recovered', alertData);
        } catch (error) {
          this.logger.error('Failed to send email recovery alert', {
            email: subscriber.email,
            error: (error as Error).message,
          });
        }
      }
    }

    // Mark recovery as sent
    await this.db.markMonitorRecoverySent(monitor.id);
  }

  /**
   * Prune healthcheck history older than specified days.
   */
  async pruneOldHistory(olderThanDays: number = 14): Promise<void> {
    this.logger.info('Pruning old healthcheck history', { olderThanDays });
    const deleted = await this.db.pruneHealthcheckHistory(olderThanDays);
    this.logger.info('Pruned healthcheck history', { deletedCount: deleted });
  }
}

export type { MonitorAlertData };
