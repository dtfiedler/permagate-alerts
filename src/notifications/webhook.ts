import { Logger } from 'winston';
import {
  NotificationData,
  NotificationProvider,
  NotificationProviderOptions,
} from './interface.js';
import { SqliteDatabase } from '../db/sqlite.js';
import { Webhook, WebhookType } from '../db/schema.js';
import { getEmailSubjectForEvent, getNotificationFields } from './content.js';

export interface WebhookNotificationProviderOptions
  extends NotificationProviderOptions {
  db: SqliteDatabase;
}

export class WebhookNotificationProvider implements NotificationProvider {
  private db: SqliteDatabase;
  private logger: Logger;
  private enabled: boolean;

  constructor({
    db,
    logger,
    enabled = true,
  }: WebhookNotificationProviderOptions) {
    this.db = db;
    this.logger = logger.child({
      module: 'WebhookNotificationProvider',
    });
    this.enabled = enabled;
  }

  async handle(data: NotificationData): Promise<void> {
    if (!this.enabled) {
      this.logger.debug('Webhook notifications are disabled');
      return;
    }

    const webhooks = await this.db.getActiveWebhooksForEventType(
      data.event.eventType,
    );

    if (webhooks.length === 0) {
      this.logger.debug('No active webhooks for event type, skipping', {
        eventType: data.event.eventType,
      });
      return;
    }

    this.logger.info('Triggering webhooks', {
      eventType: data.event.eventType,
      webhookCount: webhooks.length,
    });

    // Fire webhooks asynchronously (non-blocking)
    for (const webhook of webhooks) {
      this.fireWebhook(webhook, data);
    }
  }

  private async fireWebhook(
    webhook: Webhook,
    data: NotificationData,
  ): Promise<void> {
    this.logger.debug('Firing webhook', {
      webhookId: webhook.id,
      url: webhook.url,
      type: webhook.type,
      eventType: data.event.eventType,
    });

    try {
      const payload = await this.formatPayload(webhook.type, data);

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(
          `HTTP ${response.status}: ${response.statusText} - ${errorText}`,
        );
      }

      this.logger.debug('Webhook delivered successfully', {
        webhookId: webhook.id,
        url: webhook.url,
      });

      // Update status in background (don't await)
      this.db.updateWebhookStatus(webhook.id, 'success').catch((err) => {
        this.logger.error('Failed to update webhook status', {
          webhookId: webhook.id,
          error: err.message,
        });
      });
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      this.logger.error('Failed to deliver webhook', {
        webhookId: webhook.id,
        url: webhook.url,
        type: webhook.type,
        error: errorMessage,
      });

      // Update status in background (don't await)
      this.db.updateWebhookStatus(webhook.id, 'failed', errorMessage).catch((err) => {
        this.logger.error('Failed to update webhook status', {
          webhookId: webhook.id,
          error: err.message,
        });
      });
    }
  }

  private async formatPayload(
    type: WebhookType,
    data: NotificationData,
  ): Promise<Record<string, unknown>> {
    switch (type) {
      case 'discord':
        return this.formatDiscordPayload(data);
      case 'slack':
        return this.formatSlackPayload(data);
      case 'custom':
      default:
        return this.formatCustomPayload(data);
    }
  }

  private formatCustomPayload(data: NotificationData): Record<string, unknown> {
    return {
      eventType: data.event.eventType,
      processId: data.event.processId,
      nonce: data.event.nonce,
      blockHeight: data.event.blockHeight,
      eventData: data.event.eventData,
    };
  }

  private async formatDiscordPayload(
    data: NotificationData,
  ): Promise<Record<string, unknown>> {
    const header = await getEmailSubjectForEvent(data.event);
    const fields = await getNotificationFields(data.event);

    // Format fields as markdown text
    const fieldsText = fields
      .map((field) => `**${field.key}**: ${field.value}`)
      .join('\n');

    return {
      content: `# ${header}\n\n${fieldsText}`,
    };
  }

  private async formatSlackPayload(
    data: NotificationData,
  ): Promise<Record<string, unknown>> {
    const header = await getEmailSubjectForEvent(data.event);
    const fields = await getNotificationFields(data.event);

    // Format fields as mrkdwn text for Slack
    const fieldsText = fields
      .map((field) => `*${field.key}*: ${field.value}`)
      .join('\n');

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
            text: fieldsText,
          },
        },
      ],
    };
  }
}
