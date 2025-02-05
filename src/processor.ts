import { EmailProvider } from './email/mailgun.js';
import { GQLEvent, NewEvent, RawEvent } from './db/schema.js';
import { SqliteDatabase } from './db/sqlite.js';
import * as winston from 'winston';

interface IEventProcessor {
  processGQLEvent(event: GQLEvent): Promise<void>;
  processRawEvent(event: RawEvent): Promise<void>;
}

export class EventProcessor implements IEventProcessor {
  private db: SqliteDatabase;
  private notifier: EmailProvider | undefined;
  private logger: winston.Logger;

  constructor({
    db,
    notifier,
    logger,
  }: {
    logger: winston.Logger;
    db: SqliteDatabase;
    notifier?: EmailProvider;
  }) {
    this.db = db;
    this.notifier = notifier;
    this.logger = logger.child({
      module: 'EventProcessor',
    });
  }

  async processGQLEvent(event: GQLEvent): Promise<void> {
    const { tags, data } = event;
    const { action, nonce, target } = this.processEventTags(tags);
    if (!action || !nonce) {
      this.logger.error('No action or nonce found in event', {
        event,
      });
      return;
    }
    const newEvent: NewEvent = {
      eventType: action,
      eventData: {
        id: event.id,
        target: target || '',
        tags: tags,
        data: data,
      },
      nonce: +nonce,
    };
    this.storeAndNotify(newEvent);
  }

  private processEventTags(tags: { name: string; value: string }[]): {
    tags: { name: string; value: string }[];
    nonce: string | undefined;
    action: string | undefined;
    target: string | undefined;
  } {
    const nonce = tags.find(
      (tag) => tag.name.startsWith('Reference') || tag.name.startsWith('Ref_'),
    )?.value;
    const target = tags.find((tag) => tag.name.startsWith('Target'))?.value;
    const action = tags
      .find((tag) => tag.name.startsWith('Action'))
      ?.value.toLowerCase();
    return {
      tags,
      nonce,
      action,
      target,
    };
  }

  async processRawEvent(event: RawEvent): Promise<void> {
    for (const message of event.Messages) {
      const { action, nonce, target, tags } = this.processEventTags(
        message.Tags,
      );
      if (!action || !nonce) {
        continue;
      }
      const messageData =
        typeof message.Data === 'string'
          ? (() => {
              try {
                return JSON.parse(message.Data);
              } catch (error) {
                this.logger.error('Error parsing message data', {
                  error,
                  data: message.Data,
                });
                return message.Data;
              }
            })()
          : message.Data;
      const newEvent: NewEvent = {
        eventType: action,
        eventData: {
          id: event.Id,
          target: target || '',
          tags: tags,
          data: messageData,
        },
        nonce: +nonce,
      };
      this.storeAndNotify(newEvent);
    }
  }

  private async storeAndNotify(event: NewEvent): Promise<void> {
    const subscribers = await this.db.findSubscribersByEvent(event.eventType);

    let subscribersToNotify = subscribers;
    if (event.eventType === 'save-observations-notice') {
      const failedGateways = Object.keys(
        event.eventData.data.failureSummaries || {},
      );
      const subscribersWithAssociatedWalletAddresses =
        await this.db.findSubscribersWithAssociatedWalletAddresses(
          failedGateways,
        );
      subscribersToNotify = subscribersWithAssociatedWalletAddresses;
    }

    this.logger.info('Sending email to subscribers', {
      eventId: event.eventData.id,
      eventType: event.eventType,
      subscribers: subscribersToNotify.length,
    });

    // make sure the event is created
    await this.db.createEvent(event);
    if (subscribersToNotify.length > 0) {
      // send email, but don't await
      this.notifier
        ?.sendRawEmail({
          to: subscribersToNotify.map((subscriber) => subscriber.email),
          subject: `🚨 New ${event.eventType}!`,
          text: createEmailBody(event),
        })
        .then(() => this.db.markEventAsProcessed(+event.nonce))
        .catch((error) => {
          this.logger.error('Error sending email', { error });
        });
    } else {
      this.logger.info('No subscribers found for event', {
        eventId: event.eventData.id,
        eventType: event.eventType,
      });
      this.db.markEventAsProcessed(+event.nonce);
    }
  }
}

const createEmailBody = (event: NewEvent) => {
  switch (event.eventType) {
    case 'buy-record-notice':
      const name = event.eventData.tags.find((t) => t.name === 'Name')?.value;
      const startTimestamp = new Date(
        event.eventData.data.startTimestamp,
      ).getTime();
      const endTimestamp = new Date(
        event.eventData.data.endTimestamp,
      ).getTime();
      const leaseDurationYears = Math.round(
        (endTimestamp - startTimestamp) / (1000 * 60 * 60 * 24 * 365.25),
      );
      return `<div style=\"padding:5px; text-align: center\"><a href="https://permagate.io/UyC5P5qKPZaltMmmZAWdakhlDXsBF6qmyrbWYFchRTk"><img style="height: 200px" src=\"https://permagate.io/YSS-NnRuBLrJ1TvWFPTohK7VGKUlaUgWiG9IN9U-hjY\" /></a><h3 style="text-align: center; text-wrap: balance;   "><b><a href="https://${name}.permagate.io">${name}</a></b> was just bought by ${event.eventData.target} for <b>${event.eventData.data.purchasePrice / 1_000_000} IO</b>!</h3><br/><div style="text-align: left;"><h4>Details</h4>Owner: <a href=\"https://ao.link/#/entity/ZjmB2vEUlHlJ7-rgJkYP09N5IzLPhJyStVrK5u9dDEo\">ZjmB2vEUlHlJ7-rgJkYP09N5IzLPhJyStVrK5u9dDEo</a><br/>Type: ${event.eventData.data.type}<br/>Lease Duration: ${leaseDurationYears} years<br/>Process ID: <a href="https://ao.link/#/entity/${event.eventData.data.processId}">${event.eventData.data.processId}</a></div><br/><br/><a style="text-align: center" href="https://ao.link/#/message/${event.eventData.id}">View on AO</a></div>`;
    default:
      return `<div style=\"padding:5px; text-align: center\"><a href="https://permagate.io/UyC5P5qKPZaltMmmZAWdakhlDXsBF6qmyrbWYFchRTk"><img style="height: 200px" src=\"https://permagate.io/YSS-NnRuBLrJ1TvWFPTohK7VGKUlaUgWiG9IN9U-hjY\" /></a><h3 style="text-align: center; text-wrap: balance;">${event.eventType}</h3><br/><div style="text-align: left;"><h4>Details</h4><pre>${JSON.stringify(event.eventData.data, null, 2)}</pre></div><br/><br/><a style="text-align: center" href="https://ao.link/#/message/${event.eventData.id}">View on AO</a></div>`;
  }
};
