import { Logger } from 'winston';
import {
  NotificationData,
  NotificationProvider,
  NotificationProviderOptions,
} from './interface.js';
import { formatNameForDisplay, getEmailSubjectForEvent } from './content.js';

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

      // Create formatted text content for Discord
      const textContent = Object.entries(data.event.eventData.data)
        .flatMap(([key, value]) => {
          if (typeof value === 'object' && value !== null) {
            return Object.entries(value).map(
              ([subKey, subValue]) =>
                `**${subKey}**: ${typeof subValue === 'string' ? subValue : JSON.stringify(subValue)}`,
            );
          }
          return [
            `**${key}**: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
          ];
        })
        .join('\n');

      // Discord embed message
      const embed = {
        title: header,
        description: textContent.slice(0, 4096), // Discord description limit
        color: this.getColorForEventType(data.event.eventType),
        timestamp: new Date().toISOString(),
        fields: [
          {
            name: 'Event Type',
            value: data.event.eventType,
            inline: true,
          },
          {
            name: 'Process ID',
            value: `[${data.event.processId.slice(0, 6)}...${data.event.processId.slice(-4)}](https://ao.link/#/entity/${data.event.processId})`,
            inline: true,
          },
          ...(data.event.eventData.target
            ? [
                {
                  name: 'Target',
                  value: `[${formatNameForDisplay(data.event.eventData.target)}](https://ao.link/#/entity/${data.event.eventData.target})`,
                  inline: true,
                },
              ]
            : []),
          ...(data.event.eventData.from
            ? [
                {
                  name: 'From',
                  value: `[${formatNameForDisplay(data.event.eventData.from)}](https://ao.link/#/entity/${data.event.eventData.from})`,
                  inline: true,
                },
              ]
            : []),
        ],
        footer: {
          text: 'Permagate Alerts',
        },
      };

      const message = {
        embeds: [embed],
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

  private getColorForEventType(eventType: string): number {
    // Return different colors based on event type
    switch (eventType.toLowerCase()) {
      default:
        return 0x5865f2; // Discord Blurple
    }
  }
}
