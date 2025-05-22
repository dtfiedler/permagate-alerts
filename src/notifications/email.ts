import { Logger } from 'winston';
import { NotificationData, NotificationProvider, NotificationProviderOptions } from './interface.js';
import { EmailProvider } from '../email/mailgun.js';

export interface EmailNotificationProviderOptions extends NotificationProviderOptions {
  emailProvider: EmailProvider;
}

export class EmailNotificationProvider implements NotificationProvider {
  private emailProvider: EmailProvider;
  private logger: Logger;
  private enabled: boolean;

  constructor({ emailProvider, logger, enabled = true }: EmailNotificationProviderOptions) {
    this.emailProvider = emailProvider;
    this.logger = logger.child({
      module: 'EmailNotificationProvider',
    });
    this.enabled = enabled;
  }

  async handle(data: NotificationData): Promise<void> {
    if (!this.enabled) {
      this.logger.info('Email notifications are disabled');
      return;
    }

    if (!data.html || !data.subject) {
      this.logger.error('Missing html or subject for email notification', {
        eventType: data.event.eventType,
      });
      return;
    }

    try {
      this.logger.debug('Sending email notification', {
        recipients: data.recipients.length,
        eventType: data.event.eventType,
      });

      await this.emailProvider.sendEventEmail({
        to: data.recipients,
        subject: data.subject,
        html: data.html,
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