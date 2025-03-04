import { Knex } from 'knex';
import * as winston from 'winston';

import {
  Subscriber,
  NewSubscriber,
  Event,
  NewEvent,
  DBEvent,
} from './schema.js';

interface BaseStore {
  migrate(): Promise<void>;
  close(): Promise<void>;
}

interface SubscriberStore extends BaseStore {
  getSubscriber(id: number): Promise<Subscriber | undefined>;
  getAllSubscribers(): Promise<Subscriber[]>;
  createSubscriber(subscriber: NewSubscriber): Promise<Subscriber | undefined>;
  updateSubscriber(
    id: number,
    subscriber: Partial<Subscriber>,
  ): Promise<Subscriber | undefined>;
  deleteSubscriber(id: number): Promise<boolean>;
  findSubscribersByEvent(event: string): Promise<Subscriber[]>;
  rawQuery(query: string, params?: any[]): Promise<any>;
}

interface EventStore extends BaseStore {
  getEvent(id: number): Promise<Event | undefined>;
  getAllEvents(limit?: number): Promise<Event[]>;
  getLatestEvent(): Promise<Event | undefined>;
  createEvent(event: NewEvent): Promise<Event | undefined>;
  updateEvent(id: number, event: Partial<Event>): Promise<Event | undefined>;
  deleteEvent(id: number): Promise<boolean>;
  findEventsByEventType(eventType: string): Promise<Event[]>;
  markEventAsProcessed(id: number): Promise<boolean>;
  rawQuery(query: string, params?: any[]): Promise<any>;
}

export class SqliteDatabase implements SubscriberStore, EventStore {
  private knex: Knex;
  private logger: winston.Logger;

  constructor({ knex, logger }: { knex: Knex; logger: winston.Logger }) {
    this.knex = knex;
    this.logger = logger;
  }

  async migrate() {
    this.logger.info('Migrating database');
    await this.knex.migrate.latest();
    this.logger.info('Database migrated');
  }

  async close() {
    await this.knex.destroy();
  }

  // Subscriber Store Methods
  async getSubscriber(id: number): Promise<Subscriber | undefined> {
    return this.knex<Subscriber>('subscribers').where({ id }).first();
  }

  async getAllSubscribers(): Promise<Subscriber[]> {
    return this.knex<Subscriber>('subscribers').select('*');
  }

  async createSubscriber(
    subscriber: NewSubscriber,
  ): Promise<Subscriber | undefined> {
    const [id] = await this.knex<Subscriber>('subscribers')
      .insert(subscriber)
      .onConflict('email')
      .merge();
    return this.getSubscriber(id);
  }

  async getSubscriberByEmail(email: string): Promise<Subscriber | undefined> {
    return this.knex<Subscriber>('subscribers').where({ email }).first();
  }

  async updateSubscriber(
    id: number,
    subscriber: Partial<Subscriber>,
  ): Promise<Subscriber | undefined> {
    await this.knex<Subscriber>('subscribers').where({ id }).update(subscriber);
    return this.getSubscriber(id);
  }

  async deleteSubscriber(id: number): Promise<boolean> {
    const deleted = await this.knex<Subscriber>('subscribers')
      .where({ id })
      .del();
    return deleted > 0;
  }

  async findSubscribersByEvent(event: string): Promise<Subscriber[]> {
    return this.knex<Subscriber>('subscribers').where(
      'events',
      'LIKE',
      `%${event}%`,
    );
  }

  // Event Store Methods
  async getEvent(nonce: number): Promise<Event | undefined> {
    const event = await this.knex<DBEvent>('events').where({ nonce }).first();
    if (!event) {
      return undefined;
    }
    return {
      id: event.id,
      nonce: event.nonce,
      eventData: JSON.parse(event.event_data),
      emailsSent: event.emails_sent,
      eventType: event.event_type,
      createdAt: event.created_at,
      processedAt: event.processed_at,
    };
  }

  async getAllEvents(limit: number = 100): Promise<Event[]> {
    const events = await this.knex<DBEvent>('events')
      .select('*')
      .orderBy('nonce', 'desc')
      .limit(limit);
    return events.map(
      (event: DBEvent): Event => ({
        id: event.id,
        nonce: event.nonce,
        eventData: JSON.parse(event.event_data),
        emailsSent: event.emails_sent,
        eventType: event.event_type,
        createdAt: event.created_at,
        processedAt: event.processed_at,
      }),
    );
  }

  async getLatestEvent(): Promise<Event | undefined> {
    const events = await this.getAllEvents(1);
    return events[0];
  }

  async createEvent(event: NewEvent): Promise<Event | undefined> {
    const [id] = await this.knex<DBEvent>('events')
      .insert({
        event_type: event.eventType,
        event_data: JSON.stringify(event.eventData),
        nonce: event.nonce,
      })
      .onConflict('nonce')
      .merge();
    return this.getEvent(id);
  }

  async updateEvent(
    id: number,
    event: Partial<Event>,
  ): Promise<Event | undefined> {
    await this.knex<Event>('events').where({ id }).update(event);
    return this.getEvent(id);
  }

  async deleteEvent(id: number): Promise<boolean> {
    const deleted = await this.knex<Event>('events').where({ id }).del();
    return deleted > 0;
  }

  async findSubscribersWithAssociatedWalletAddresses(
    walletAddresses: string[],
  ): Promise<Subscriber[]> {
    return (
      this.knex<Subscriber>('subscribers')
        .select('subscribers.*', 'subscriber_wallets.wallet_address')
        // ensures only subscribers with an affiliated wallet address are returned
        .innerJoin(
          'subscriber_wallets',
          'subscribers.id',
          'subscriber_wallets.subscriber_id',
        )
        .whereIn('subscriber_wallets.wallet_address', walletAddresses)
    );
  }

  async findEventsByEventType(eventType: string): Promise<Event[]> {
    const events = await this.knex<DBEvent>('events').where({
      event_type: eventType,
    });
    return events.map(
      (event: DBEvent): Event => ({
        id: event.id,
        nonce: event.nonce,
        eventData: JSON.parse(event.event_data),
        emailsSent: event.emails_sent,
        eventType: event.event_type,
        createdAt: event.created_at,
        processedAt: event.processed_at,
      }),
    );
  }

  async markEventAsProcessed(nonce: number): Promise<boolean> {
    const updated = await this.knex<DBEvent>('events')
      .where({ nonce })
      .update({ processed_at: this.knex.fn.now() });
    return updated > 0;
  }

  async rawQuery(query: string): Promise<any> {
    return this.knex.raw(query);
  }
}
