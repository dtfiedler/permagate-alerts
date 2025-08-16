import { Logger } from 'winston';
import {
  NotificationData,
  NotificationProvider,
  NotificationProviderOptions,
} from './interface.js';
import axios from 'axios';
import { getEmailSubjectForEvent, getNotificationFields } from './content.js';

export interface SlackNotificationProviderOptions
  extends NotificationProviderOptions {
  webhookUrl: string;
}

export class SlackNotificationProvider implements NotificationProvider {
  private webhookUrl: string;
  private logger: Logger;
  private enabled: boolean;

  constructor({
    webhookUrl,
    logger,
    enabled = true,
  }: SlackNotificationProviderOptions) {
    this.webhookUrl = webhookUrl;
    this.logger = logger.child({
      module: 'SlackNotificationProvider',
    });
    this.enabled = enabled;
  }

  async handle(data: NotificationData): Promise<void> {
    if (!this.enabled) {
      this.logger.info('Slack notifications are disabled');
      return;
    }

    try {
      const header = await getEmailSubjectForEvent(data.event);
      const fields = await getNotificationFields(data.event);

      // Format fields as markdown text to match email content
      const fieldsText = fields
        .map((field) => `**${field.key}**: ${field.value}`)
        .join('\n');

      // Simple Slack message matching email content
      const message = {
        text: `${header}\n\n${fieldsText}`,
      };

      this.logger.debug('Sending Slack notification', {
        eventType: data.event.eventType,
      });

      await axios.post(this.webhookUrl, message);

      this.logger.debug('Slack notification sent successfully', {
        eventType: data.event.eventType,
      });
    } catch (error) {
      this.logger.error('Failed to send Slack notification', {
        error,
        eventType: data.event.eventType,
      });
      throw error;
    }
  }
}
