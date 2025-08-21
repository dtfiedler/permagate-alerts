import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { default as cors } from 'cors';
import { logger } from './logger.js';
import { router } from './router.js';
import * as system from './system.js';
import { stripeRouter } from './routes/stripe.js';
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000; // define port with environment variable or default to 3000

// attach database and logger to all requests
app.use(async (req: Request, _res: Response, next: NextFunction) => {
  // @ts-ignore
  req.db = system.db;
  // @ts-ignore
  req.mailer = system.emailProvider;
  // @ts-ignore
  req.logger = logger;
  // @ts-ignore
  req.processor = system.processor;
  // @ts-ignore
  req.arweave = system.arweave;
  next();
});

// setup local public directory
app.use(express.static(path.join(__dirname, 'public')));

// setup cors for all routes
app.use(cors());

// stripe added before any middleware as we need to parse the raw body
app.use(stripeRouter);

// middleware
app.use(express.json());
app.use(express.text());
app.use(express.urlencoded({ extended: false }));

// remaining routes that leverage all the middleware above
app.use(router);

// add logger to app context
app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});
