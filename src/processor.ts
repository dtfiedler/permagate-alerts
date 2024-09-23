import { EventEmail, EventProvider } from './email/mailgun.js';
import { EventMessage, RawEvent } from './db/schema.js';
import { SqliteDatabase } from './db/sqlite.js';
import * as winston from 'winston';

interface IEventProcessor {
  processEvent(event: RawEvent): Promise<void>;
}

function parseBase64Tags(tags: EventMessage['Tags']) {
  return tags.map((tag) => {
    return {
      name: tag.name,
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

  async processEvent(event: RawEvent): Promise<void> {
    try {
      // parse out the nonce from the tags
      const tags = parseBase64Tags(event.Messages[0].Tags);
      const nonce = tags.find((tag) => tag.name.startsWith('Ref_'))?.value;
      const action = tags.find((tag) => tag.name.startsWith('Action'))?.value;
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
      for (const subscriber of subscribers) {
        const eventEmail: EventEmail = {
          eventType: action,
          eventData: JSON.parse(event.Messages[0].Data), // already stringified
          to: [subscriber.email],
          subject: `New ${action} event`,
        };
        await this.notifier?.sendEventEmail(eventEmail);
      }
      await this.db.createEvent(event);
      await this.db.markEventAsProcessed(+nonce);
    } catch (error) {
      this.logger.error('Error creating event:', error);
    }
  }
}
