import { Router, Response } from 'express';
import { logger } from '../logger.js';
import crypto from 'crypto';
import { Request } from '../types.js';
import * as config from '../config.js';
import { z } from 'zod';
import { NewSubscriber, subscriberEventSchema } from '../db/schema.js';
import { generateUnsubscribeLink } from '../lib/hash.js';

const apiRouter = Router();

// Healthcheck
apiRouter.get('/healthcheck', (_, res) => {
  res.send('OK');
});

// Route to add a new subscriber
// @ts-ignore
apiRouter.post('/api/subscribe', async (req: Request, res: Response) => {
  try {
    const email = req.query.email as string;
    const events = (req.body.events as string[]) || [];

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const emailSchema = z.string().email();
    const validatedEmail = emailSchema.safeParse(email);

    if (!validatedEmail.success) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const eventsSchema = z.array(subscriberEventSchema);

    const validatedEvents = eventsSchema.safeParse(events);

    if (!validatedEvents.success) {
      return res.status(400).json({
        error: `Unsupported event type provided ${events.join(', ')}`,
      });
    }

    const subscriberData: NewSubscriber = {
      email: validatedEmail.data,
      events:
        validatedEvents.data.length > 0
          ? validatedEvents.data.join(',')
          : undefined,
    };
    const subscriber = await req.db.createSubscriber(subscriberData);
    logger.info(`New subscriber added: ${email}`);

    // Function to generate a signed hash
    const unsubscribeLink = generateUnsubscribeLink(email);

    // send intro email in background
    req.notifier?.sendRawEmail({
      to: [email],
      text: `You have successfully been subscribed to alerts.permagate.io!

You will receive alerts for the following events: ${subscriber?.events?.split(',').join(', ')}

To unsubscribe, click here: ${unsubscribeLink}`,
      subject: 'Subscription successful! 🚀',
    });
    return res.status(200).json(subscriber);
  } catch (error) {
    logger.error('Error processing subscribe request:', error);
    res
      .status(500)
      .json({ error: 'An error occurred while processing your request' });
  }
});

// Route to handle unsubscribe requests
apiRouter.get(
  '/api/unsubscribe/:hash',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const { hash } = req.params;

      if (!hash) {
        return res.status(400).json({ error: 'Hash is required' });
      }

      const [encodedEmail, givenHmac] = hash.split('.');
      const email = Buffer.from(encodedEmail, 'base64url').toString('utf8');

      logger.info(`Unsubscribing email: ${email}`);

      const subscriber = await req.db.getSubscriberByEmail(email);

      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      // Verify the hash
      const expectedHmacForEmail = crypto
        .createHmac('sha256', config.secretKey)
        .update(email)
        .digest('hex');

      // Convert Buffers to Uint8Array
      const givenHmacBuffer = new Uint8Array(Buffer.from(givenHmac, 'hex'));
      const expectedHmacBuffer = new Uint8Array(
        Buffer.from(expectedHmacForEmail, 'hex'),
      );

      if (!crypto.timingSafeEqual(givenHmacBuffer, expectedHmacBuffer)) {
        logger.error(`Invalid unsubscribe link for email: ${email}`);
        return res.status(400).json({ error: 'Invalid unsubscribe link' });
      }

      logger.info(`Verified hash for email: ${email}`);

      await req.db.updateSubscriber(subscriber.id, {
        events: '',
      });

      logger.info(`Unsubscribe request processed for email: ${email}`);
      res.status(200).json({ message: 'Successfully unsubscribed' });
    } catch (error) {
      logger.error('Error processing unsubscribe request:', error);
      res
        .status(500)
        .json({ error: 'An error occurred while processing your request' });
    }
    return;
  },
);

export { apiRouter };
