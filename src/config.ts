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
export const logLevel = process.env.LOG_LEVEL || 'info';
export const port = process.env.PORT ? +process.env.PORT : 3000;
export const environment: string = process.env.NODE_ENV || 'development';
export const hostUrl = process.env.HOST_URL || 'http://localhost:3000';
export const skipToCurrentBlock = process.env.SKIP_TO_CURRENT_BLOCK === 'true';
export const gqlUrl =
  process.env.GQL_URL || 'https://arweave-search.goldsky.com/graphql';

// Event processing
export const disableEventProcessing =
  process.env.DISABLE_EVENT_PROCESSING === 'true';

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
export const disableEmails = process.env.DISABLE_EMAIL_NOTIFICATIONS === 'true';

// Notifications
export const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
export const enableSlackNotifications =
  process.env.ENABLE_SLACK_NOTIFICATIONS === 'true';
export const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
export const enableDiscordNotifications =
  process.env.ENABLE_DISCORD_NOTIFICATIONS === 'true';
export const webhookEndpoints = process.env.WEBHOOK_ENDPOINTS
  ? JSON.parse(process.env.WEBHOOK_ENDPOINTS)
  : [];

// CoinGecko
export const priceServiceTTLSeconds = process.env.PRICE_SERVICE_TTL_SECONDS
  ? +process.env.PRICE_SERVICE_TTL_SECONDS
  : 60 * 60; // 1 hour

// Admin
export const adminApiKey = process.env.ADMIN_API_KEY;
export const adminNotificationEmailAddress =
  process.env.ADMIN_NOTIFICATION_EMAIL_ADDRESS || 'support@racetrainer.ai';
export const secretKey = process.env.SECRET_KEY || 'default_secret_key';
export const frontendUrl =
  process.env.FRONTEND_URL || 'https://subscribe.permagate.io';

// Database
export const debugKnex = process.env.DEBUG_KNEX === 'true';

// AO
export const cuUrl = process.env.CU_URL || 'https://cu.ardrive.io';
export const gatewayHost = process.env.GATEWAY_HOST || 'arweave.net';
export const arioProcessId = process.env.ARIO_PROCESS_ID;

// Stripe
export const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
export const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// enable hosted frontend
export const enableHostedFrontend =
  process.env.ENABLE_HOSTED_FRONTEND === 'true';

// AWS
export const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
export const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
export const awsRegion = process.env.AWS_REGION || 'us-east-1';
export const awsFromEmail =
  process.env.AWS_FROM_EMAIL || 'noreply@permagate.io';
