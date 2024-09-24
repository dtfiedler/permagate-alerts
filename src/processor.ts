import { EventProvider } from './email/mailgun.js';
import { NewEvent, WebhookEvent } from './db/schema.js';
import { SqliteDatabase } from './db/sqlite.js';
import * as winston from 'winston';

interface IEventProcessor {
  processEvent(event: WebhookEvent): Promise<void>;
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
  private notifier: EventProvider | undefined;
  private logger: winston.Logger;
  constructor({
    db,
    notifier,
    logger,
  }: {
    logger: winston.Logger;
    db: SqliteDatabase;
    notifier?: EventProvider;
  }) {
    this.db = db;
    this.notifier = notifier;
    this.logger = logger.child({
      module: 'EventProcessor',
    });
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
      const existingEvent = await this.db.getEvent(+nonce);
      if (existingEvent) {
        this.logger.info('Event already exists, ignoring', {
          existingEvent,
        });
        return;
      }
      const subscribers = await this.db.findSubscribersByEvent(action);
      this.logger.debug('Found subscribers', { subscribers });
      const newEvent: NewEvent = {
        eventType: action,
        eventData: {
          tags: tags,
          rawTags: event.data.tags,
          data: undefined, // TODO: fetch event data from ao
        },
        nonce: +nonce,
      };
      await this.notifier?.sendEventEmail({
        ...newEvent,
        to: subscribers.map((subscriber) => subscriber.email),
        subject: `🚨 New ${action}!`,
      });
      await this.db.createEvent(newEvent);
      await this.db.markEventAsProcessed(+nonce);
    } catch (error) {
      this.logger.error('Error creating event:', error);
    }
  }
}
