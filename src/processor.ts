import { EventEmail, EventProvider } from './email/mailgun.js';
import { NewEvent } from './db/schema.js';
import { SqliteDatabase } from './db/sqlite.js';
import * as winston from 'winston';

interface IEventProcessor {
  processEvent(event: NewEvent): Promise<void>;
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

  async processEvent(event: NewEvent): Promise<void> {
    try {
      const existingEvent = await this.db.getEvent(event.nonce);
      if (existingEvent) {
        return;
      }
      const subscribers = await this.db.findSubscribersByEvent(event.eventType);
      for (const subscriber of subscribers) {
        const eventEmail: EventEmail = {
          eventType: event.eventType,
          eventData: event.eventData,
          to: [subscriber.email],
          subject: `New ${event.eventType} event`,
        };
        await this.notifier?.sendEventEmail(eventEmail);
      }
      await this.db.createEvent(event);
      await this.db.markEventAsProcessed(event.nonce);
    } catch (error) {
      this.logger.error('Error creating event:', error);
    }
  }
}
