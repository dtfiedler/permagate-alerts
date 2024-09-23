import { Request as ExpressRequest } from 'express';
import { SqliteDatabase } from './db/sqlite.js';
import * as winston from 'winston';
import { EventProvider } from './email/mailgun.js';
import { EventProcessor } from './processor.js';

export interface Request extends ExpressRequest {
  db: SqliteDatabase;
  notifier: EventProvider;
  processor: EventProcessor;
  logger: winston.Logger;
}
