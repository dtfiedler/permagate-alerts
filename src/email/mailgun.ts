import Mailgun from 'mailgun.js';
import { IMailgunClient } from 'mailgun.js/Interfaces';
import FormData from 'form-data';
import { NewEvent, Event } from '../db/schema.js';
import { Logger } from 'winston';

const mailgun = new Mailgun.default(FormData);

export interface EventEmail extends NewEvent {
  to: string[];
  subject: string;
  body: string;
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
  private client: IMailgunClient;
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
      to: data.to,
      subject: data.subject,
      text: data.text,
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
      to: data.to,
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

  async sendEventEmail(data: EventEmail): Promise<void> {
    const { eventType, to, body, subject } = data;
    return this.sendEmailFromTemplate({
      to,
      subject,
      templateId: 'permagate-alert',
      variables: {
        title: subject,
        heading: eventType.replace(/-/g, ' ').toUpperCase(),
        body,
      },
    });
  }
}
