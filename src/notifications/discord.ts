import { Logger } from 'winston';
import {
  NotificationData,
  NotificationProvider,
  NotificationProviderOptions,
} from './interface.js';
import { getEmailSubjectForEvent, getNotificationFields } from './content.js';

export interface DiscordNotificationProviderOptions
  extends NotificationProviderOptions {
  webhookUrl: string;
}

export class DiscordNotificationProvider implements NotificationProvider {
  private webhookUrl: string;
  private logger: Logger;
  private enabled: boolean;

  constructor({
    webhookUrl,
    logger,
    enabled = true,
  }: DiscordNotificationProviderOptions) {
    this.webhookUrl = webhookUrl;
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

    try {
      const header = await getEmailSubjectForEvent(data.event);
      const fields = await getNotificationFields(data.event);

      // Format fields as markdown text to match email content
      const fieldsText = fields.map(field => `**${field.key}**: ${field.value}`).join('\n');

      // Simple Discord message matching email content
      const message = {
        content: `${header}\n\n${fieldsText}`,
      };

      this.logger.debug('Sending Discord notification', {
        eventType: data.event.eventType,
      });

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        throw new Error(`Discord webhook request failed: ${response.status} ${response.statusText}`);
      }

      this.logger.debug('Discord notification sent successfully', {
        eventType: data.event.eventType,
      });
    } catch (error) {
      this.logger.error('Failed to send Discord notification', {
        error,
        eventType: data.event.eventType,
      });
      throw error;
    }
  }
}
