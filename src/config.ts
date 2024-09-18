// require dotenv
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Derive __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// read in the .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Server configuration
export const port = process.env.PORT ? +process.env.PORT : 3000;
export const environment: string = process.env.NODE_ENV || 'development';

// Auth0 configuration
export const auth0Domain = process.env.AUTH0_DOMAIN;
export const auth0Audience = process.env.AUTH0_AUDIENCE;
export const auth0Namespace = process.env.AUTH0_NAMESPACE;
export const auth0ClientId = process.env.AUTH0_CLIENT_ID;
export const auth0ClientSecret = process.env.AUTH0_CLIENT_SECRET;

// Email
export const mailgunApiKey = process.env.MAILGUN_API_KEY;
export const mailgunFromEmail = process.env.MAILGUN_FROM_EMAIL;
export const mailgunDomain = process.env.MAILGUN_DOMAIN;

// Admin
export const adminApiKey = process.env.ADMIN_API_KEY;
export const adminNotificationEmailAddress =
  process.env.ADMIN_NOTIFICATION_EMAIL_ADDRESS || 'support@racetrainer.ai';
export const secretKey = process.env.SECRET_KEY || 'default_secret_key';

// Database
export const debugKnex = process.env.DEBUG_KNEX === 'true';
