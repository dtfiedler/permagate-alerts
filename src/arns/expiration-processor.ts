import { Logger } from 'winston';
import { SqliteDatabase } from '../db/sqlite.js';
import { NotificationProvider } from '../notifications/index.js';
import { ArNSName, ArNSNotificationType, NewEvent } from '../db/schema.js';

const GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds
const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 1 day in milliseconds

interface ArNSExpirationProcessorOptions {
  db: SqliteDatabase;
  logger: Logger;
  notificationProvider: NotificationProvider;
}

/**
 * Processor to check for expiring ArNS names and send notifications.
 * Sends notifications at two points:
 * 1. When name enters grace period (endTimestamp reached)
 * 2. 1 day before grace period ends
 */
export class ArNSExpirationProcessor {
  private db: SqliteDatabase;
  private logger: Logger;
  private notificationProvider: NotificationProvider;

  constructor(options: ArNSExpirationProcessorOptions) {
    this.db = options.db;
    this.logger = options.logger.child({ module: 'ArNSExpirationProcessor' });
    this.notificationProvider = options.notificationProvider;
  }

  /**
   * Process all expiring ArNS names and send notifications.
   */
  async processExpiringNames(): Promise<void> {
    this.logger.info('Processing ArNS name expirations');
    const now = Date.now();

    // 1. Check for names entering grace period (endTimestamp reached)
    await this.processGracePeriodStart(now);

    // 2. Check for names 1 day before grace period ends
    await this.processGracePeriodEnding(now);

    this.logger.info('Completed processing ArNS expirations');
  }

  /**
   * Process names that have just entered the grace period.
   * endTimestamp has been reached, 14 days remaining.
   */
  private async processGracePeriodStart(now: number): Promise<void> {
    // Find leased names where endTimestamp <= now
    const names = await this.db.findArNSNamesEnteringGracePeriod(now);

    for (const name of names) {
      const alreadySent = await this.db.hasNotificationBeenSent(
        name.name,
        'grace_period_start',
        name.end_timestamp,
      );

      if (alreadySent) {
        continue;
      }

      this.logger.info('Sending grace period start notification', {
        name: name.name,
        endTimestamp: name.end_timestamp,
        owner: name.owner,
      });

      await this.sendExpirationNotification(name, 'grace_period_start');

      await this.db.recordNotificationSent(
        name.name,
        'grace_period_start',
        name.end_timestamp,
      );
    }
  }

  /**
   * Process names 1 day before grace period ends.
   * Grace period ends at endTimestamp + 14 days.
   * Notify when now >= (endTimestamp + 13 days).
   */
  private async processGracePeriodEnding(now: number): Promise<void> {
    // We want to notify when there's approximately 1 day left in the grace period
    // Grace period ends at: endTimestamp + 14 days
    // So we notify when: now >= endTimestamp + 13 days
    // Which means: endTimestamp <= now - 13 days
    const thirteenDaysAgo = now - (GRACE_PERIOD_MS - ONE_DAY_MS);

    const names = await this.db.findArNSNamesGracePeriodEnding(thirteenDaysAgo);

    for (const name of names) {
      const alreadySent = await this.db.hasNotificationBeenSent(
        name.name,
        'grace_period_ending',
        name.end_timestamp,
      );

      if (alreadySent) {
        continue;
      }

      this.logger.info('Sending grace period ending notification', {
        name: name.name,
        endTimestamp: name.end_timestamp,
        gracePeriodEndsAt: name.end_timestamp + GRACE_PERIOD_MS,
        owner: name.owner,
      });

      await this.sendExpirationNotification(name, 'grace_period_ending');

      await this.db.recordNotificationSent(
        name.name,
        'grace_period_ending',
        name.end_timestamp,
      );
    }
  }

  /**
   * Send expiration notification using the notification system.
   */
  private async sendExpirationNotification(
    arnsName: ArNSName,
    notificationType: ArNSNotificationType,
  ): Promise<void> {
    const gracePeriodEndsAt = arnsName.end_timestamp + GRACE_PERIOD_MS;
    const daysRemaining = notificationType === 'grace_period_start' ? 14 : 1;

    // Create a synthetic event for the notification system
    // Use a unique nonce based on name + type + end_timestamp to prevent duplicates
    const nonceString = `${arnsName.name}-${notificationType}-${arnsName.end_timestamp}`;
    const nonce = this.hashStringToNumber(nonceString);

    const event: NewEvent = {
      eventType: 'arns-name-expiration-notice',
      processId: arnsName.process_id,
      blockHeight: null,
      nonce,
      eventData: {
        id: `arns-expiration-${arnsName.name}-${notificationType}-${arnsName.end_timestamp}`,
        target: arnsName.owner,
        from: null,
        tags: [
          { name: 'Action', value: 'arns-name-expiration-notice' },
          { name: 'Name', value: arnsName.name },
          { name: 'Notification-Type', value: notificationType },
        ],
        data: {
          name: arnsName.name,
          owner: arnsName.owner,
          processId: arnsName.process_id,
          endTimestamp: arnsName.end_timestamp,
          gracePeriodEndsAt,
          daysRemaining,
          notificationType,
        },
      },
    };

    try {
      // Store the event
      await this.db.createEvent(event);

      // Send notifications
      await this.notificationProvider.handle({ event });

      // Mark as processed
      await this.db.markEventAsProcessed(nonce);
    } catch (error) {
      this.logger.error('Error sending expiration notification', {
        name: arnsName.name,
        notificationType,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Hash a string to a number for use as a nonce.
   */
  private hashStringToNumber(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
