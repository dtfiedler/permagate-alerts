import express, { NextFunction, Request, Response } from 'express';
import { default as cors } from 'cors';
import { logger } from './logger.js';
import { router } from './router.js';
import * as system from './system.js';

const app = express();
const port = process.env.PORT || 3000; // define port with environment variable or default to 3000

// attach database and logger to all requests
app.use((req: Request, _res: Response, next: NextFunction) => {
  // @ts-ignore
  req.db = system.db;
  // @ts-ignore
  req.notifier = system.notifier;
  // @ts-ignore
  req.logger = logger;
  // @ts-ignore
  req.processor = system.processor;
  // @ts-ignore
  req.arweave = system.arweave;
  next();
});

// Middleware
app.use(express.json());
app.use(express.text());
app.use(express.urlencoded({ extended: false }));
app.use(cors());
app.use(router);
// add logger to app context
app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});
