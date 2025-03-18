import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { generateUnsubscribeLink, generateVerifyLink } from './hash.js';
import * as config from '../config.js';

describe('Hash utility functions', () => {
  beforeEach(() => {
    // Ensure config values are set for testing
    process.env.HOST_URL = 'https://test.example.com';
    process.env.SECRET_KEY = 'test-secret-key';
  });

  describe('generateUnsubscribeLink', () => {
    it('should generate a valid unsubscribe link', () => {
      const email = 'test@example.com';
      const link = generateUnsubscribeLink(email);

      // Check that the link contains the base64url encoded email
      const encodedEmail = Buffer.from(email).toString('base64url');
      assert.ok(link.includes(encodedEmail));

      // Check that the link has the correct format
      assert.ok(link.startsWith(config.hostUrl + '/api/unsubscribe/'));

      // Check that the link contains a hash component
      const hashPart = link.split('/').pop();
      assert.ok(hashPart?.includes('.'));

      // Verify the structure: encodedEmail.hash
      const [linkEncodedEmail, hash] = hashPart?.split('.') ?? [];
      assert.equal(linkEncodedEmail, encodedEmail);
      assert.ok(hash.length > 0);
    });

    it('should generate different links for different emails', () => {
      const email1 = 'test1@example.com';
      const email2 = 'test2@example.com';

      const link1 = generateUnsubscribeLink(email1);
      const link2 = generateUnsubscribeLink(email2);

      assert.notEqual(link1, link2);
    });
  });

  describe('generateVerifyLink', () => {
    it('should generate a valid verify link', () => {
      const email = 'test@example.com';
      const link = generateVerifyLink(email);

      // Check that the link contains the base64url encoded email
      const encodedEmail = Buffer.from(email).toString('base64url');
      assert.ok(link.includes(encodedEmail));

      // Check that the link has the correct format
      assert.ok(link.startsWith(config.hostUrl + '/api/subscribe/verify/'));

      // Check that the link contains a hash component
      const hashPart = link.split('/').pop();
      assert.ok(hashPart?.includes('.'));

      // Verify the structure: encodedEmail.hash
      const [linkEncodedEmail, hash] = hashPart?.split('.') ?? [];
      assert.equal(linkEncodedEmail, encodedEmail);
      assert.ok(hash?.length > 0);
    });

    it('should generate different links for different emails', () => {
      const email1 = 'test1@example.com';
      const email2 = 'test2@example.com';

      const link1 = generateVerifyLink(email1);
      const link2 = generateVerifyLink(email2);

      assert.notEqual(link1, link2);
    });
  });

  it('should generate consistent hashes for the same email', () => {
    const email = 'test@example.com';

    const unsubscribeLink1 = generateUnsubscribeLink(email);
    const unsubscribeLink2 = generateUnsubscribeLink(email);

    const verifyLink1 = generateVerifyLink(email);
    const verifyLink2 = generateVerifyLink(email);

    assert.equal(unsubscribeLink1, unsubscribeLink2);
    assert.equal(verifyLink1, verifyLink2);
  });
});
