import { EmailProvider } from './email/mailgun.js';
import { NewEvent, WebhookEvent, Event, DBEvent } from './db/schema.js';
import { SqliteDatabase } from './db/sqlite.js';
import * as winston from 'winston';
import Arweave from 'arweave';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface IEventProcessor {
  processEvent(event: WebhookEvent): Promise<void>;
  processDailyDigest(): Promise<void>;
}

function parseBase64Tags(tags: { name: string; value: string }[]): {
  name: string;
  value: string;
}[] {
  return tags.map((tag) => {
    return {
      name: Buffer.from(tag.name, 'base64').toString('utf-8'),
      value: Buffer.from(tag.value, 'base64').toString('utf-8'),
    };
  });
}

export class EventProcessor implements IEventProcessor {
  private db: SqliteDatabase;
  private notifier: EmailProvider | undefined;
  private logger: winston.Logger;
  private arweave: Arweave;

  constructor({
    db,
    notifier,
    logger,
    arweave,
  }: {
    logger: winston.Logger;
    db: SqliteDatabase;
    notifier?: EmailProvider;
    arweave: any;
  }) {
    this.db = db;
    this.notifier = notifier;
    this.logger = logger.child({
      module: 'EventProcessor',
    });
    this.arweave = arweave;
  }

  async processEvent(event: WebhookEvent): Promise<void> {
    try {
      this.logger.debug('Processing event', { event });
      const tags = parseBase64Tags(event.data.tags);
      const nonce = tags.find((tag) => tag.name.startsWith('Ref_'))?.value;
      const action = tags
        .find((tag) => tag.name.startsWith('Action'))
        ?.value.toLowerCase();
      if (!nonce || !action) {
        this.logger.error('No nonce or action found in event', {
          tags,
          event,
        });
        return;
      }
      // const existingEvent = await this.db.getEvent(+nonce);
      // if (existingEvent) {
      //   this.logger.info('Event already exists, ignoring', {
      //     existingEvent,
      //   });
      //   return;
      // }
      // const lastEvent = await this.db.getLatestEvent();
      // if (lastEvent && +nonce < lastEvent.nonce) {
      //   this.logger.info('Event is older than the last event, ignoring', {
      //     nonce,
      //     lastEvent,
      //   });
      //   return;
      // }
      const messageData = await this.arweave.api
        .get(event.data.id)
        .then((data) => data.data);
      const subscribers = await this.db.findSubscribersByEvent(action);
      this.logger.debug('Found subscribers', { subscribers });
      const newEvent: NewEvent = {
        eventType: action,
        eventData: {
          id: event.data.id,
          target: event.data.target,
          tags: tags,
          data: messageData,
        },
        nonce: +nonce,
      };
      const body = await createEmailBody(newEvent);
      await this.notifier?.sendEventEmail({
        ...newEvent,
        to: subscribers.map((subscriber) => subscriber.email),
        subject: `🚨 New ${action}!`,
        body,
      });
      await this.db.createEvent(newEvent);
      await this.db.markEventAsProcessed(+nonce);
    } catch (error) {
      this.logger.error('Error creating event:', error);
    }
  }

  private createDigestEventMap(events: Event[]): Map<string, Event[]> {
    const eventMap = new Map<string, Event[]>();
    for (const event of events) {
      const eventType = event.eventType;
      if (!eventMap.has(eventType)) {
        eventMap.set(eventType, []);
      }
      eventMap.get(eventType)?.push(event);
    }
    return eventMap;
  }

  async processDailyDigest(): Promise<void> {
    this.logger.info('Processing daily digest');
    const events: Event[] = await this.db
      .rawQuery(
        `SELECT * FROM events WHERE created_at > datetime('now', '-1 day')`,
      )
      .then((events: DBEvent[]) =>
        events.map((event) => ({
          id: event.id,
          emailsSent: event.emails_sent,
          eventType: event.event_type,
          eventData: JSON.parse(event.event_data),
          nonce: event.nonce,
          createdAt: event.created_at,
          processedAt: event.processed_at,
        })),
      );
    const subscribers = await this.db.getAllSubscribers();
    const eventMap = this.createDigestEventMap(events);
    const subject = `ℹ️ Permagate Daily Digest 📝 `;
    await this.notifier?.sendDigestEmail({
      to: subscribers.map((subscriber) => subscriber.email),
      subject,
      digestItems: eventMap,
    });
  }
}

const createEmailBody = async (event: NewEvent) => {
  switch (event.eventType) {
    case 'buy-record-notice':
      const name = event.eventData.tags.find((t) => t.name === 'Name')?.value;
      const url = `https://${name}.permagate.io`;
      const browser = await puppeteer.launch();
      const page = await browser.newPage();

      // Navigate to the provided URL
      await page.goto(url, {
        waitUntil: 'networkidle2',
      });

      // Take a screenshot
      await page.screenshot({
        fullPage: true,
        type: 'png',
        optimizeForSpeed: true,
        path: path.join(__dirname, 'public', 'temp', `${name}.png`),
      });

      // Close the browser
      await browser.close();
      const startTimestamp = new Date(
        event.eventData.data.startTimestamp,
      ).getTime();
      const endTimestamp = new Date(
        event.eventData.data.endTimestamp,
      ).getTime();
      const leaseDurationYears = Math.round(
        (endTimestamp - startTimestamp) / (1000 * 60 * 60 * 24 * 365.25),
      );
      return `<div style=\"padding:5px; text-align: center\"><a href="https://${name}.permagate.io"><img style="height: 200px" src=\"https://alerts.permagate.io/temp/${name}.png\" /></a><h3 style="text-align: center; text-wrap: balance;   "><b><a href="https://${name}.permagate.io">${name}</a></b> was just bought by ${event.eventData.target} for <b>${event.eventData.data.purchasePrice / 1_000_000} IO</b>!</h3><br/><div style="text-align: left;"><h4>Details</h4>Owner: <a href=\"https://ao.link/#/entity/ZjmB2vEUlHlJ7-rgJkYP09N5IzLPhJyStVrK5u9dDEo\">ZjmB2vEUlHlJ7-rgJkYP09N5IzLPhJyStVrK5u9dDEo</a><br/>Type: ${event.eventData.data.type}<br/>Lease Duration: ${leaseDurationYears} years<br/>Process ID: <a href="https://ao.link/#/entity/${event.eventData.data.processId}">${event.eventData.data.processId}</a></div><br/><br/><a style="text-align: center" href="https://ao.link/#/message/${event.eventData.id}">View on AO</a></div>`;
    default:
      return '';
  }
};
