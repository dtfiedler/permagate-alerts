import crypto from 'crypto';
import * as config from '../config.js';

// Utility function to generate unsubscribe URL (can be used when sending emails)
export function generateUnsubscribeUrl(email: string): string {
  const hash = crypto
    .createHmac('sha256', config.secretKey)
    .update(email)
    .digest('hex');
  return `/api/unsubscribe/${encodeURIComponent(email)}/${hash}`;
}
