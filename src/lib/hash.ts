import crypto from 'node:crypto';
import * as config from '../config.js';

// Utility function to generate unsubscribe URL (can be used when sending emails)
export const generateUnsubscribeLink = (email: string) => {
  return `${config.hostUrl}/api/unsubscribe/${generateHashForEmail(email)}`;
};

// Utility function to generate verify URL (can be used when sending emails)
export const generateVerifyLink = (email: string) => {
  return `${config.hostUrl}/api/subscribe/verify/${generateHashForEmail(email)}`;
};

export const generateManageLink = (email: string) => {
  return `${config.hostUrl}/api/subscribe/manage/${generateHashForEmail(email)}`;
};

export const generateHashForEmail = (email: string) => {
  const hash = crypto
    .createHmac('sha256', config.secretKey)
    .update(email)
    .digest('hex');
  const encodedEmail = Buffer.from(email).toString('base64url');
  return `${encodedEmail}.${hash}`;
};

export const decodeHashAndEmail = (
  hash: string,
): { decodedEmail: string; decodedHash: string } => {
  const [encodedEmail, decodedHash] = hash.split('.');
  const decodedEmail = Buffer.from(encodedEmail, 'base64url').toString('utf8');
  return { decodedEmail, decodedHash };
};

export const verifyHash = (
  hash: string,
): { valid: boolean; decodedEmail: string } => {
  const { decodedEmail, decodedHash } = decodeHashAndEmail(hash);
  const expectedHmacForEmail = crypto
    .createHmac('sha256', config.secretKey)
    .update(decodedEmail)
    .digest('hex');

  const givenHmacBuffer = new Uint8Array(Buffer.from(decodedHash, 'hex'));
  const expectedHmacBuffer = new Uint8Array(
    Buffer.from(expectedHmacForEmail, 'hex'),
  );
  return {
    valid: crypto.timingSafeEqual(givenHmacBuffer, expectedHmacBuffer),
    decodedEmail,
  };
};
