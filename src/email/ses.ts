import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { Logger } from 'winston';

export interface EventEmail {
  to: string[];
  subject: string;
  html: string;
}

export interface EmailProvider {
  sendRawEmail(data: {
    to: string[];
    subject: string;
    text: string;
  }): Promise<void>;
  sendEventEmail(data: EventEmail): Promise<void>;
}

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

  constructor({
    accessKeyId,
    secretAccessKey,
    region,
    from,
    logger,
  }: SESEmailProviderOptions) {
    this.client = new SESClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
    this.from = from;
    this.logger = logger;
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
    const result = await this.send(new SendEmailCommand(params));
    this.logger.info('Email sent', {
      to: data.to,
      subject: data.subject,
      text: data.text,
      result,
    });
  }

  async sendEventEmail({ to, html, subject }: EventEmail): Promise<void> {
    const params = {
      Source: this.from,
      Destination: {
        ToAddresses: [this.from],
        BccAddresses: to,
      },
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: html } },
      },
    };
    const result = await this.send(new SendEmailCommand(params));
    this.logger.info('Email sent', {
      to: to,
      subject: subject,
      html: html,
      result,
    });
  }
}
