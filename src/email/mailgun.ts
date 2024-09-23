import Mailgun from 'mailgun.js';
import { IMailgunClient } from 'mailgun.js/Interfaces';
import FormData from 'form-data';

const mailgun = new Mailgun.default(FormData);

export interface EventEmail {
  eventType: string;
  eventData: Record<string, unknown>;
  to: string[];
  subject: string;
}

export interface DigestEmailData {
  to: string[];
  subject: string;
  digestPeriod: 'daily' | 'weekly' | 'monthly';
  digestItems: Array<{
    type: string;
    details: Record<string, unknown>;
  }>;
}

export interface EventProvider {
  sendEventEmail(data: EventEmail): Promise<void>;
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

export class MailgunEmailProvider implements EventProvider {
  private client: IMailgunClient;
  private from: string;
  private domain: string;

  constructor({
    apiKey,
    from,
    domain,
  }: EmailProviderOptions & { domain: string }) {
    this.client = mailgun.client({
      username: 'api',
      key: apiKey,
    });
    this.domain = domain;
    this.from = from;
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

  async sendEventEmail(data: EventEmail): Promise<void> {
    const { eventType, eventData, to, subject } = data;
    const text = `Alert Type: ${eventType}\n\nDetails:\n${JSON.stringify(eventData, null, 2)}`;
    await this.sendRawEmail({ to, subject, text });
  }

  async sendDigest(data: DigestEmailData): Promise<void> {
    const { to, subject, digestPeriod, digestItems } = data;
    const text = `Digest Period: ${digestPeriod}\n\nItems:\n${digestItems
      .map(
        (item) =>
          `Type: ${item.type}\nDetails: ${JSON.stringify(item.details, null, 2)}`,
      )
      .join('\n\n')}`;
    await this.sendRawEmail({ to, subject, text });
  }
}
