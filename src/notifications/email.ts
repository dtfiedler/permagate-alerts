import { Logger } from 'winston';
import {
  NotificationDataWithRecipients,
  NotificationProvider,
  NotificationProviderOptions,
} from './interface.js';
import { EmailProvider } from '../email/ses.js';
import { generateNotificationContent } from './content.js';
import { SqliteDatabase } from '../db/sqlite.js';

export interface EmailNotificationProviderOptions
  extends NotificationProviderOptions {
  emailProvider: EmailProvider;
  db: SqliteDatabase;
}

export class EmailNotificationProvider implements NotificationProvider {
  private emailProvider: EmailProvider;
  private logger: Logger;
  private enabled: boolean;
  private db: SqliteDatabase;

  constructor({
    emailProvider,
    db,
    logger,
    enabled = true,
  }: EmailNotificationProviderOptions) {
    this.emailProvider = emailProvider;
    this.logger = logger.child({
      module: 'EmailNotificationProvider',
    });
    this.enabled = enabled;
    this.db = db;
  }

  async handle(data: NotificationDataWithRecipients): Promise<void> {
    if (!this.enabled) {
      this.logger.info('Email notifications are disabled');
      return;
    }

    const subscribers = await this.db.findSubscribersByEvent({
      processId: data.event.processId,
      event: data.event.eventType,
      target: data.event.eventData.target,
    });

    const emailData = await generateNotificationContent(
      data.event,
      this.logger,
    );

    if (!emailData.html || !emailData.subject) {
      this.logger.error('Missing html or subject for email notification', {
        eventType: data.event.eventType,
      });
      return;
    }

    if (subscribers.length === 0) {
      this.logger.info('No subscribers found for event', {
        eventId: data.event.eventData.id,
        eventType: data.event.eventType,
      });
      return;
    }

    try {
      this.logger.debug('Sending email notification to subscribers', {
        recipients: subscribers.length,
        eventType: data.event.eventType,
        eventId: data.event.eventData.id,
      });

      await this.emailProvider.sendEventEmail({
        to: subscribers.map((subscriber) => subscriber.email),
        subject: emailData.subject,
        html: emailData.html,
      });

      this.logger.debug('Email notification sent successfully', {
        eventType: data.event.eventType,
      });
    } catch (error) {
      this.logger.error('Failed to send email notification', {
        error,
        eventType: data.event.eventType,
      });
      throw error;
    }
  }
}
