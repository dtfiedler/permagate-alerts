import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { Event } from '../db/schema.js';
import { Logger } from 'winston';
import type { EmailProvider, EventEmail, DigestEmailData } from './mailgun.js';

export interface SESEmailProviderOptions {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  from: string;
  logger: Logger;
}

export class SESEmailProvider implements EmailProvider {
  private client: SESClient;
  private from: string;
  private logger: Logger;

  constructor(options: SESEmailProviderOptions) {
    this.client = new SESClient({
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
    this.from = options.from;
    this.logger = options.logger.child({ module: 'SESEmailProvider' });
  }

  private async send(command: SendEmailCommand) {
    await this.client.send(command);
  }

  async sendRawEmail(data: {
    to: string[];
    subject: string;
    text: string;
  }): Promise<void> {
    const params = {
      Source: this.from,
      Destination: {
        ToAddresses: ['noreply@permagate.io'],
        BccAddresses: data.to,
      },
      Message: {
        Subject: { Data: data.subject },
        Body: { Text: { Data: data.text } },
      },
    };
    await this.send(new SendEmailCommand(params));
  }

  async sendEventEmail({ to, html, subject }: EventEmail): Promise<void> {
    const params = {
      Source: this.from,
      Destination: {
        ToAddresses: ['noreply@permagate.io'],
        BccAddresses: to,
      },
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: html } },
      },
    };
    await this.send(new SendEmailCommand(params));
  }

  async sendDigestEmail(data: DigestEmailData): Promise<void> {
    const { to, subject, digestItems } = data;
    let text = '';
    for (const [eventType, events] of digestItems) {
      text += `\n${eventType}\n${events
        .map(
          (event: Event) => `${JSON.stringify(event.eventData.tags, null, 2)}`,
        )
        .join('\n')}\n`;
    }
    const fullText = `Permagate Digest\n\n${text}`;
    this.logger.info(`Sending digest email to ${to} with subject ${subject}`);
    await this.sendRawEmail({ to, subject, text: fullText });
  }
}
