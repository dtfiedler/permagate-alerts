import { Request as ExpressRequest } from 'express';
import { SqliteDatabase } from './db/sqlite.js';
import * as winston from 'winston';
import { EmailProvider } from './email/ses.js';
import { EventProcessor } from './processor.js';

export interface Request extends ExpressRequest {
  db: SqliteDatabase;
  mailer?: EmailProvider;
  processor: EventProcessor;
  logger: winston.Logger;
  rawBody: string;
}
