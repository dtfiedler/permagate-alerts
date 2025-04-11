import { Knex } from 'knex';
import * as winston from 'winston';

import {
  Subscriber,
  NewSubscriber,
  Event,
  NewEvent,
  DBEvent,
  Process,
  SubscribeToProcess,
  ProcessEventSubscription,
} from './schema.js';

interface BaseStore {
  migrate(): Promise<void>;
  close(): Promise<void>;
}

interface SubscriberStore extends BaseStore {
  getSubscriber(id: number): Promise<Subscriber | undefined>;
  getAllSubscribers(): Promise<Subscriber[]>;
  updateSubscriber(
    id: number,
    subscriber: Partial<Subscriber>,
  ): Promise<Subscriber | undefined>;
  deleteSubscriber(id: number): Promise<boolean>;
  findSubscribersByEvent({
    processId,
    event,
  }: {
    processId: string;
    event: string;
  }): Promise<Subscriber[]>;
  rawQuery(query: string, params?: any[]): Promise<any>;
  createSubscriberForProcess({
    subscriber,
    processId,
    events,
  }: {
    subscriber: NewSubscriber;
    processId?: string;
    events?: ProcessEventSubscription[];
  }): Promise<Subscriber | undefined>;
}

interface EventStore extends BaseStore {
  getEvent(id: number): Promise<Event | undefined>;
  getAllEvents(limit?: number): Promise<Event[]>;
  getLatestEventByBlockHeight({
    processId,
  }: {
    processId: string;
  }): Promise<Event | undefined>;
  getLatestEventByNonce({
    processId,
  }: {
    processId: string;
  }): Promise<Event | undefined>;
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

  async getTotalSubscribers(): Promise<number> {
    const result = await this.knex<Subscriber>('subscribers')
      .count<{ count: string | number | undefined }>('* as count')
      .first();
    return Number(result?.count || 0);
  }

  async getProcessByProcessId(processId: string): Promise<Process | undefined> {
    return this.knex<Process>('processes')
      .where({ process_id: processId })
      .first();
  }

  async createNewSubscriber({
    email,
    ...params
  }: { email: string } & Partial<NewSubscriber>): Promise<
    Subscriber | undefined
  > {
    const [subscriber] = await this.knex<Subscriber>('subscribers')
      .insert({ email, ...params })
      .returning('*');

    return subscriber;
  }

  async createSubscriberForProcess({
    subscriber,
    processId,
    events = [],
  }: {
    subscriber: NewSubscriber;
    processId?: string;
    events?: ProcessEventSubscription[];
  }): Promise<Subscriber | undefined> {
    const [id] = await this.knex<Subscriber>('subscribers')
      .insert(subscriber)
      .onConflict('email')
      .merge();

    // no id is returned if the subscriber already exists, so we need to get it from the db
    if (!id) {
      return this.getSubscriberByEmail(subscriber.email);
    }

    if (processId) {
      await this.updateSubscriberForProcess({
        subscriberId: id,
        processId,
        events,
      });
    }

    return this.getSubscriber(id);
  }

  async getSubscriberByEmail(email: string): Promise<Subscriber | undefined> {
    return this.knex<Subscriber>('subscribers').where({ email }).first();
  }

  async verifySubscriber(id: number): Promise<Subscriber | undefined> {
    const updated = await this.knex<Subscriber>('subscribers')
      .where({ id })
      .update({ verified: true })
      .returning('*');
    return updated[0];
  }

  async getSubscribedEventsForSubscriber({
    subscriberId,
  }: {
    subscriberId: number;
  }): Promise<
    {
      processId: string;
      eventType: string;
      addresses: string[];
    }[]
  > {
    const subscribedEvents = await this.knex<SubscribeToProcess>(
      'subscriber_processes',
    )
      .where({
        subscriber_id: subscriberId,
      })
      .select('process_id', 'event_type', 'address');

    return subscribedEvents.map((event) => ({
      processId: event.process_id,
      eventType: event.event_type,
      addresses: event.address ? event.address.split(',') : [],
    }));
  }

  async updateSubscriberForProcess({
    subscriberId,
    processId,
    events,
  }: {
    subscriberId: number;
    processId: string;
    events: ProcessEventSubscription[];
  }): Promise<boolean> {
    const existingSubscriptions = await this.knex<SubscribeToProcess>(
      'subscriber_processes',
    ).where({
      subscriber_id: subscriberId,
      process_id: processId,
    });

    if (existingSubscriptions.length > 0) {
      // delete the existing subscriptions
      await this.knex<SubscribeToProcess>('subscriber_processes')
        .where({
          subscriber_id: subscriberId,
          process_id: processId,
        })
        .del();
    }

    if (events.length === 0) {
      return true;
    }

    await this.knex<SubscribeToProcess>('subscriber_processes').insert(
      events.map((event: ProcessEventSubscription) => ({
        subscriber_id: subscriberId,
        process_id: processId,
        event_type: event.eventType,
        // TODO: this name is confusing, it's not an address but a comma separated list of addresses
        address: event.addresses.join(','),
      })),
    );

    return true;
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

  async findSubscribersByEvent({
    processId,
    event,
    target,
  }: {
    processId: string;
    event: string;
    target?: string;
  }): Promise<Subscriber[]> {
    // join on subscribers and filter where verified
    const query = this.knex<Subscriber>('subscribers')
      .join(
        'subscriber_processes',
        'subscribers.id',
        '=',
        'subscriber_processes.subscriber_id',
      )
      .where({
        'subscribers.verified': 1,
        'subscriber_processes.process_id': processId,
        'subscriber_processes.event_type': event,
      });

    if (target) {
      query.andWhere(function () {
        this.whereNull('subscriber_processes.address')
          .orWhere('subscriber_processes.address', '')
          .orWhere('subscriber_processes.address', 'like', `%${target}%`);
      });
    }

    const subscribersForProcessEvent = await query.select('subscribers.*');

    return subscribersForProcessEvent;
  }

  // Event Store Methods
  async getEvent(nonce: number): Promise<Event | undefined> {
    const event = await this.knex<DBEvent>('events').where({ nonce }).first();
    if (!event) {
      return undefined;
    }
    return {
      id: event.id,
      processId: event.process_id,
      nonce: event.nonce,
      eventData: JSON.parse(event.event_data),
      blockHeight: event.block_height,
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
    return events.map((event: DBEvent): Event => {
      const eventData = JSON.parse(event.event_data);
      return {
        id: event.id,
        processId: event.process_id,
        nonce: event.nonce,
        eventData: eventData,
        blockHeight: event.block_height,
        emailsSent: event.emails_sent,
        eventType: event.event_type,
        createdAt: event.created_at,
        processedAt: event.processed_at,
      };
    });
  }

  async getLatestEventByBlockHeight({
    processId,
  }: {
    processId: string;
  }): Promise<Event | undefined> {
    const event = await this.knex<DBEvent>('events')
      .whereNotNull('block_height')
      .where({ process_id: processId })
      .orderBy('block_height', 'desc')
      .orderBy('nonce', 'desc')
      .first();
    if (!event) {
      return undefined;
    }
    return this.getEvent(event.nonce);
  }

  async getLatestEventByNonce({
    processId,
  }: {
    processId: string;
  }): Promise<Event | undefined> {
    const event = await this.knex<DBEvent>('events')
      .where({ process_id: processId })
      .orderBy('nonce', 'desc')
      .first();
    if (!event) {
      return undefined;
    }
    return this.getEvent(event.nonce);
  }

  async createEvent(event: NewEvent): Promise<Event | undefined> {
    const [id] = await this.knex<DBEvent>('events')
      .insert({
        event_type: event.eventType,
        event_data: JSON.stringify(event.eventData),
        process_id: event.processId,
        block_height: event.blockHeight,
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
        processId: event.process_id,
        nonce: event.nonce,
        eventData: JSON.parse(event.event_data),
        blockHeight: event.block_height,
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
