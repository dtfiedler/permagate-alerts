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
  Webhook,
  NewWebhook,
  DBWebhook,
  WebhookType,
  WebhookEventLink,
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
      .select('process_id', 'event_type', 'address')
      .groupBy('process_id', 'event_type');

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

  // Webhook Store Methods
  private dbWebhookToWebhook(dbWebhook: DBWebhook): Webhook {
    return {
      id: dbWebhook.id,
      subscriber_id: dbWebhook.subscriber_id,
      url: dbWebhook.url,
      description: dbWebhook.description,
      type: dbWebhook.type as WebhookType,
      active: Boolean(dbWebhook.active),
      authorization: dbWebhook.authorization,
      last_status: dbWebhook.last_status as 'success' | 'failed' | null,
      last_error: dbWebhook.last_error,
      last_triggered_at: dbWebhook.last_triggered_at,
      created_at: dbWebhook.created_at,
      updated_at: dbWebhook.updated_at,
    };
  }

  async createWebhook(webhook: NewWebhook): Promise<Webhook | undefined> {
    const [id] = await this.knex<DBWebhook>('webhooks')
      .insert({
        subscriber_id: webhook.subscriber_id,
        url: webhook.url,
        description: webhook.description ?? null,
        type: webhook.type ?? 'custom',
        active: webhook.active ?? true,
        authorization: webhook.authorization ?? null,
      })
      .returning('id');

    if (!id) {
      return undefined;
    }

    return this.getWebhook(typeof id === 'object' ? id.id : id);
  }

  async getWebhook(id: number): Promise<Webhook | undefined> {
    const webhook = await this.knex<DBWebhook>('webhooks').where({ id }).first();
    if (!webhook) {
      return undefined;
    }
    return this.dbWebhookToWebhook(webhook);
  }

  async getWebhooksForSubscriber(subscriberId: number): Promise<Webhook[]> {
    const webhooks = await this.knex<DBWebhook>('webhooks')
      .where({ subscriber_id: subscriberId })
      .orderBy('created_at', 'desc');
    return webhooks.map((w) => this.dbWebhookToWebhook(w));
  }

  async getActiveWebhooksForEventType(eventType: string): Promise<Webhook[]> {
    // Get active webhooks that are linked to this event type via webhook_events
    const webhooks = await this.knex<DBWebhook>('webhooks')
      .join('webhook_events', 'webhooks.id', '=', 'webhook_events.webhook_id')
      .where({
        'webhooks.active': true,
        'webhook_events.event_type': eventType,
      })
      .select('webhooks.*');
    return webhooks.map((w) => this.dbWebhookToWebhook(w));
  }

  async updateWebhook(
    id: number,
    partial: Partial<Omit<Webhook, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<Webhook | undefined> {
    await this.knex<DBWebhook>('webhooks')
      .where({ id })
      .update({
        ...partial,
        updated_at: this.knex.fn.now(),
      });
    return this.getWebhook(id);
  }

  async updateWebhookStatus(
    id: number,
    status: 'success' | 'failed',
    error?: string,
  ): Promise<void> {
    await this.knex<DBWebhook>('webhooks')
      .where({ id })
      .update({
        last_status: status,
        last_error: error ?? null,
        last_triggered_at: new Date().toISOString(),
        updated_at: this.knex.fn.now(),
      });
  }

  async deleteWebhook(id: number): Promise<boolean> {
    const deleted = await this.knex<DBWebhook>('webhooks').where({ id }).del();
    return deleted > 0;
  }

  // Webhook Events (linking) Methods
  async addWebhookEvent(webhookId: number, eventType: string): Promise<void> {
    await this.knex<WebhookEventLink>('webhook_events')
      .insert({
        webhook_id: webhookId,
        event_type: eventType,
      })
      .onConflict(['webhook_id', 'event_type'])
      .ignore();
  }

  async removeWebhookEvent(
    webhookId: number,
    eventType: string,
  ): Promise<boolean> {
    const deleted = await this.knex<WebhookEventLink>('webhook_events')
      .where({ webhook_id: webhookId, event_type: eventType })
      .del();
    return deleted > 0;
  }

  async getWebhookEvents(webhookId: number): Promise<string[]> {
    const events = await this.knex<WebhookEventLink>('webhook_events')
      .where({ webhook_id: webhookId })
      .select('event_type');
    return events.map((e) => e.event_type);
  }

  async setWebhookEvents(
    webhookId: number,
    eventTypes: string[],
  ): Promise<void> {
    // Delete existing and insert new ones
    await this.knex<WebhookEventLink>('webhook_events')
      .where({ webhook_id: webhookId })
      .del();

    if (eventTypes.length > 0) {
      await this.knex<WebhookEventLink>('webhook_events').insert(
        eventTypes.map((event_type) => ({
          webhook_id: webhookId,
          event_type,
        })),
      );
    }
  }

  async getWebhooksForSubscriberByEventType(
    subscriberId: number,
  ): Promise<Map<string, Webhook[]>> {
    // Get all webhooks for subscriber with their linked event types
    const results = await this.knex<DBWebhook>('webhooks')
      .leftJoin('webhook_events', 'webhooks.id', '=', 'webhook_events.webhook_id')
      .where({ 'webhooks.subscriber_id': subscriberId })
      .select('webhooks.*', 'webhook_events.event_type');

    const webhooksByEventType = new Map<string, Webhook[]>();

    for (const row of results) {
      const eventType = (row as any).event_type;
      if (!eventType) continue;

      const webhook = this.dbWebhookToWebhook(row);
      if (!webhooksByEventType.has(eventType)) {
        webhooksByEventType.set(eventType, []);
      }
      webhooksByEventType.get(eventType)!.push(webhook);
    }

    return webhooksByEventType;
  }
}
