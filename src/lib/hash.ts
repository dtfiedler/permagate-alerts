import crypto from 'crypto';
import * as config from '../config.js';

// Utility function to generate unsubscribe URL (can be used when sending emails)
export const generateUnsubscribeLink = (email: string) => {
  const hash = crypto
    .createHmac('sha256', config.secretKey)
    .update(email)
    .digest('hex');
  const encodedEmail = Buffer.from(email).toString('base64url');
  const unsubscribeHash = `${encodedEmail}.${hash}`;
  return `${config.hostUrl}/api/unsubscribe/${unsubscribeHash}`;
};

// Utility function to generate verify URL (can be used when sending emails)
export const generateVerifyLink = (email: string) => {
  const hash = crypto
    .createHmac('sha256', config.secretKey)
    .update(email)
    .digest('hex');
  const encodedEmail = Buffer.from(email).toString('base64url');
  const verifyHash = `${encodedEmail}.${hash}`;
  return `${config.hostUrl}/api/subscribe/verify/${verifyHash}`;
};
