import Mailgun from 'mailgun.js';
import { Interfaces } from 'mailgun.js/definitions';
import FormData from 'form-data';
import { Event } from '../db/schema.js';
import { Logger } from 'winston';

const mailgun = new Mailgun.default(FormData);

export interface EventEmail {
  to: string[];
  subject: string;
  html: string;
}

export interface DigestEmailData {
  to: string[];
  subject: string;
  digestItems: Map<string, Event[]>;
}

export interface EmailProvider {
  sendEventEmail(data: EventEmail): Promise<void>;
  sendDigestEmail(data: DigestEmailData): Promise<void>;
  sendRawEmail(data: {
    to: string[];
    subject: string;
    text: string;
  }): Promise<void>;
}

export interface EmailProviderOptions {
  apiKey: string;
  from: string;
}

export class MailgunEmailProvider implements EmailProvider {
  private client: Interfaces.IMailgunClient;
  private from: string;
  private domain: string;
  private logger: Logger;

  constructor({
    apiKey,
    from,
    domain,
    logger,
  }: EmailProviderOptions & { domain: string; logger: Logger }) {
    this.client = mailgun.client({
      username: 'api',
      key: apiKey,
    });
    this.domain = domain;
    this.from = from;
    this.logger = logger.child({
      module: 'MailgunEmailProvider',
    });
  }

  async sendRawEmail(data: {
    to: string[];
    subject: string;
    text: string;
  }): Promise<void> {
    const emailData = {
      from: this.from,
      to: 'noreply@permagate.io',
      subject: data.subject,
      text: data.text,
      bcc: data.to.join(','),
    };

    await this.client.messages.create(this.domain, emailData);
  }

  async sendEmailFromTemplate(data: {
    to: string[];
    templateId: string;
    subject: string;
    variables: any;
  }): Promise<void> {
    const emailData = {
      from: this.from,
      to: 'noreply@permagate.io',
      bcc: data.to.join(','),
      subject: data.subject,
      template: data.templateId,
      'h:X-Mailgun-Variables': JSON.stringify(data.variables),
    };

    await this.client.messages.create(this.domain, emailData);
  }

  async sendDigestEmail(data: DigestEmailData): Promise<void> {
    const { to, subject, digestItems } = data;
    this.logger.info('Sending digest email', {
      to,
      subject,
    });
    let text = '';
    for (const [eventType, events] of digestItems) {
      text += `\n${eventType}\n${events
        .map(
          (event: Event) => `${JSON.stringify(event.eventData.tags, null, 2)}`,
        )
        .join('\n')}\n`;
    }
    const fullText = `Permagate Digest\n\n${text}`;
    this.logger.info(`Sending digest email to ${to} with subject ${subject}`, {
      text: fullText,
    });
    return this.sendRawEmail({ to, subject, text });
  }

  async sendEventEmail({ to, html, subject }: EventEmail): Promise<void> {
    await this.client.messages.create(this.domain, {
      from: this.from,
      to: 'noreply@permagate.io',
      subject,
      html,
      bcc: to.join(','),
    });
  }
}
