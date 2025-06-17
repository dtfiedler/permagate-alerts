import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { EmailProvider, EventEmail } from './mailgun.js';

export interface SESEmailProviderOptions {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  from: string;
}

export class SESEmailProvider implements EmailProvider {
  private client: SESClient;
  private from: string;

  constructor({
    accessKeyId,
    secretAccessKey,
    region,
    from,
  }: SESEmailProviderOptions) {
    this.client = new SESClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
    this.from = from;
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
        ToAddresses: data.to,
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
}
