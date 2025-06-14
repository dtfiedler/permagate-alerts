import { GQLEvent, NewEvent, RawEvent } from './db/schema.js';
import { SqliteDatabase } from './db/sqlite.js';
import * as winston from 'winston';
import { NotificationProvider } from './notifications/index.js';

interface IEventProcessor {
  processGQLEvent(event: GQLEvent): Promise<void>;
  processRawEvent(event: RawEvent): Promise<void>;
}

export class EventProcessor implements IEventProcessor {
  private db: SqliteDatabase;
  private notificationProvider: NotificationProvider;
  private logger: winston.Logger;

  constructor({
    db,
    notificationProvider,
    logger,
  }: {
    logger: winston.Logger;
    db: SqliteDatabase;
    notificationProvider: NotificationProvider;
  }) {
    this.db = db;
    this.notificationProvider = notificationProvider;
    this.logger = logger.child({
      module: 'EventProcessor',
    });
  }

  async processGQLEvent(event: GQLEvent): Promise<void> {
    const { tags, data, block, recipient } = event;
    const { action, nonce, target, processId, from } =
      this.processEventTags(tags);
    if (!action || !nonce || !processId) {
      this.logger.error('No action or nonce or process ID found in event', {
        event,
      });
      return;
    }
    const newEvent: NewEvent = {
      eventType: action,
      eventData: {
        id: event.id,
        target: recipient || target || '',
        from: from || '',
        tags: tags,
        data: data,
      },
      processId: processId,
      blockHeight: block.height,
      nonce: +nonce,
    };
    this.storeAndNotify(newEvent);
  }

  private processEventTags(tags: { name: string; value: string }[]): {
    tags: { name: string; value: string }[];
    nonce: string | undefined;
    action: string | undefined;
    target: string | undefined;
    processId: string | undefined;
    from: string | undefined;
  } {
    const nonce = tags.find(
      (tag) => tag.name.startsWith('Reference') || tag.name.startsWith('Ref_'),
    )?.value;
    const target =
      tags.find((tag) => tag.name.startsWith('Target'))?.value ||
      tags.find((tag) => tag.name.startsWith('Pushed-For'))?.value;
    const action = tags
      .find((tag) => tag.name.startsWith('Action'))
      ?.value.toLowerCase();
    const processId = tags.find((tag) => tag.name === 'From-Process')?.value;
    const from = tags.find((tag) => tag.name === 'From')?.value;
    return {
      tags,
      nonce,
      action,
      target,
      processId,
      from,
    };
  }

  async processRawEvent(event: RawEvent): Promise<void> {
    for (const message of event.Messages) {
      const { action, nonce, target, tags, from } = this.processEventTags(
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
          from: from || '',
          tags: tags,
          data: messageData,
        },
        processId: 'placeholder', // TODO: add process ID on raw events
        blockHeight: null, // TODO: add block height on raw events
        nonce: +nonce,
      };
      this.storeAndNotify(newEvent);
    }
  }

  private async storeAndNotify(event: NewEvent): Promise<void> {
    // confirm the nonce is greater than the last seen
    const existingEvent = await this.db.getEvent(event.nonce);
    if (existingEvent) {
      this.logger.info('Skipping event that already exists', {
        eventId: event.eventData.id,
        nonce: event.nonce,
        eventType: event.eventType,
      });
      return;
    }
    // TODO: for certain events, we only want to notify on the first occurrence of an event within the epoch

    // make sure the event is created
    await this.db.createEvent(event);

    // Check if we're using the new notification system
    try {
      // Send notifications using the composite provider
      await this.notificationProvider
        .handle({
          event,
        })
        .then(() => this.db.markEventAsProcessed(+event.nonce))
        .catch((error) => {
          this.logger.error('Error sending notifications', { error });
        });
    } catch (error) {
      this.logger.error('Error generating notification content', { error });
    }
  }
}
