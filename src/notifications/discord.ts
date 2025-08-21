import { Logger } from 'winston';
import {
  NotificationData,
  NotificationProvider,
  NotificationProviderOptions,
} from './interface.js';
import { getEmailSubjectForEvent, getNotificationFields } from './content.js';

export interface DiscordNotificationProviderOptions
  extends NotificationProviderOptions {
  webhookUrls: string[];
}

export class DiscordNotificationProvider implements NotificationProvider {
  private webhookUrls: string[];
  private logger: Logger;
  private enabled: boolean;

  constructor({
    webhookUrls,
    logger,
    enabled = true,
  }: DiscordNotificationProviderOptions) {
    this.webhookUrls = webhookUrls;
    this.logger = logger.child({
      module: 'DiscordNotificationProvider',
    });
    this.enabled = enabled;
  }

  async handle(data: NotificationData): Promise<void> {
    if (!this.enabled) {
      this.logger.info('Discord notifications are disabled');
      return;
    }

    if (this.webhookUrls.length === 0) {
      this.logger.info('No Discord webhook URLs configured');
      return;
    }

    try {
      const header = await getEmailSubjectForEvent(data.event);
      const fields = await getNotificationFields(data.event);

      // Format fields as markdown text to match email content
      const fieldsText = fields
        .map((field) => `**${field.key}**: ${field.value}`)
        .join('\n');

      // Simple Discord message matching email content
      const message = {
        content: `${header}\n\n${fieldsText}`,
      };

      this.logger.debug('Sending Discord notifications', {
        eventType: data.event.eventType,
        webhookCount: this.webhookUrls.length,
      });

      // Send to all configured Discord webhooks concurrently
      const promises = this.webhookUrls.map(async (webhookUrl, index) => {
        try {
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
          });

          if (!response.ok) {
            throw new Error(
              `Discord webhook request failed: ${response.status} ${response.statusText}`,
            );
          }

          this.logger.debug('Discord notification sent successfully', {
            eventType: data.event.eventType,
            webhookIndex: index,
          });
        } catch (error) {
          this.logger.error('Failed to send Discord notification to webhook', {
            error,
            eventType: data.event.eventType,
            webhookIndex: index,
            webhookUrl: webhookUrl.substring(0, 50) + '...',
          });
          // Re-throw to let CompositeNotificationProvider handle it
          throw error;
        }
      });

      await Promise.all(promises);

      this.logger.debug('All Discord notifications sent successfully', {
        eventType: data.event.eventType,
        webhookCount: this.webhookUrls.length,
      });
    } catch (error) {
      this.logger.error('Failed to send Discord notifications', {
        error,
        eventType: data.event.eventType,
      });
      throw error;
    }
  }
}
