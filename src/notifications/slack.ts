import { Logger } from 'winston';
import {
  NotificationData,
  NotificationProvider,
  NotificationProviderOptions,
} from './interface.js';
import axios from 'axios';

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
      // Create a simplified text-only version if no text is provided
      const text = data.text || `New ${data.event.eventType} event`;

      // Basic message for Slack
      const message = {
        text: data.subject || `Permagate Alert: ${data.event.eventType}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: data.subject || `Permagate Alert: ${data.event.eventType}`,
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: text.slice(0, 3000),
            },
          },
          ...(text.length > 3000
            ? [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: text.slice(3000, 6000),
                  },
                },
              ]
            : []),
          ...(text.length > 6000
            ? [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: text.slice(6000, 9000),
                  },
                },
              ]
            : []),
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Event Type:*\n${data.event.eventType}`,
              },
              {
                type: 'mrkdwn',
                text: `*Process ID:*\n${data.event.processId.slice(0, 6)}...${data.event.processId.slice(-4)}`,
              },
            ],
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Target:*\n${data.event.eventData.target ? `${data.event.eventData.target.slice(0, 6)}...${data.event.eventData.target.slice(-4)}` : 'N/A'}`,
              },
              {
                type: 'mrkdwn',
                text: `*From:*\n${data.event.eventData.from ? `${data.event.eventData.from.slice(0, 6)}...${data.event.eventData.from.slice(-4)}` : 'N/A'}`,
              },
            ],
          },
        ],
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
