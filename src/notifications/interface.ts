import { Logger } from 'winston';
import { NewEvent } from '../db/schema.js';

export interface NotificationData {
  event: NewEvent;
  html?: string;
  subject?: string;
  text?: string;
  recipients: string[];
}

export interface NotificationProvider {
  /**
   * Handle the notification for a given event
   * @param data Notification data including event details and recipients
   */
  handle(data: NotificationData): Promise<void>;
}

export interface NotificationProviderOptions {
  logger: Logger;
  enabled?: boolean;
}

export class CompositeNotificationProvider implements NotificationProvider {
  private providers: NotificationProvider[];
  private logger: Logger;

  constructor({
    providers,
    logger,
  }: {
    providers: NotificationProvider[];
    logger: Logger;
  }) {
    this.providers = providers;
    this.logger = logger.child({
      module: 'CompositeNotificationProvider',
    });
  }

  async handle(data: NotificationData): Promise<void> {
    this.logger.debug('Handling notification with composite provider', {
      providersCount: this.providers.length,
      eventType: data.event.eventType,
    });

    const promises = this.providers.map((provider) =>
      provider.handle(data).catch((error) => {
        this.logger.error('Error sending notification with provider', {
          message: error.message,
          stack: error.stack,
          provider: provider.constructor.name,
        });
      }),
    );

    await Promise.all(promises);
  }
}
