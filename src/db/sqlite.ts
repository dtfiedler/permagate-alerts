import { Knex } from "knex";
import * as winston from "winston";

import { Subscriber, NewSubscriber, Alert, NewAlert } from "./schema.js";

interface BaseStore {
  migrate(): Promise<void>;
  close(): Promise<void>;
}

interface SubscriberStore extends BaseStore {
  getSubscriber(id: number): Promise<Subscriber | undefined>;
  getAllSubscribers(): Promise<Subscriber[]>;
  createSubscriber(subscriber: NewSubscriber): Promise<Subscriber>;
  updateSubscriber(
    id: number,
    subscriber: Partial<Subscriber>,
  ): Promise<Subscriber | undefined>;
  deleteSubscriber(id: number): Promise<boolean>;
  findSubscribersByEvent(event: string): Promise<Subscriber[]>;
  rawQuery(query: string, params?: any[]): Promise<any>;
}

interface EventStore extends BaseStore {
  getAlert(id: number): Promise<Alert | undefined>;
  getAllAlerts(): Promise<Alert[]>;
  createAlert(alert: NewAlert): Promise<Alert>;
  updateAlert(id: number, alert: Partial<Alert>): Promise<Alert | undefined>;
  deleteAlert(id: number): Promise<boolean>;
  findAlertsByEventType(eventType: string): Promise<Alert[]>;
  markAlertAsProcessed(id: number): Promise<boolean>;
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
    this.logger.info("Migrating database");
    await this.knex.migrate.latest();
    this.logger.info("Database migrated");
  }

  async close() {
    await this.knex.destroy();
  }

  // Subscriber Store Methods
  async getSubscriber(id: number): Promise<Subscriber | undefined> {
    return this.knex<Subscriber>("subscribers").where({ id }).first();
  }

  async getAllSubscribers(): Promise<Subscriber[]> {
    return this.knex<Subscriber>("subscribers").select("*");
  }

  async createSubscriber(subscriber: NewSubscriber): Promise<Subscriber> {
    const [id] = await this.knex<Subscriber>("subscribers")
      .insert(subscriber)
      .onConflict("email")
      .merge();
    return this.getSubscriber(id) as Promise<Subscriber>;
  }

  async updateSubscriber(
    id: number,
    subscriber: Partial<Subscriber>,
  ): Promise<Subscriber | undefined> {
    await this.knex<Subscriber>("subscribers").where({ id }).update(subscriber);
    return this.getSubscriber(id);
  }

  async deleteSubscriber(id: number): Promise<boolean> {
    const deleted = await this.knex<Subscriber>("subscribers")
      .where({ id })
      .del();
    return deleted > 0;
  }

  async findSubscribersByEvent(event: string): Promise<Subscriber[]> {
    return this.knex<Subscriber>("subscribers")
      .whereRaw("JSON_ARRAY_CONTAINS(events, ?)", [JSON.stringify(event)]);
  }

  // Event Store Methods
  async getAlert(id: number): Promise<Alert | undefined> {
    return this.knex<Alert>("alerts").where({ id }).first();
  }

  async getAllAlerts(): Promise<Alert[]> {
    return this.knex<Alert>("alerts").select("*");
  }

  async createAlert(alert: NewAlert): Promise<Alert> {
    const [id] = await this.knex<Alert>("alerts").insert(alert);
    return this.getAlert(id) as Promise<Alert>;
  }

  async updateAlert(
    id: number,
    alert: Partial<Alert>,
  ): Promise<Alert | undefined> {
    await this.knex<Alert>("alerts").where({ id }).update(alert);
    return this.getAlert(id);
  }

  async deleteAlert(id: number): Promise<boolean> {
    const deleted = await this.knex<Alert>("alerts").where({ id }).del();
    return deleted > 0;
  }

  async findAlertsByEventType(eventType: string): Promise<Alert[]> {
    return this.knex<Alert>("alerts").where({ eventType });
  }

  async markAlertAsProcessed(id: number): Promise<boolean> {
    const updated = await this.knex<Alert>("alerts")
      .where({ id })
      .update({ processedAt: this.knex.fn.now() });
    return updated > 0;
  }

  async rawQuery(query: string): Promise<any> {
    return this.knex.raw(query);
  }
}
