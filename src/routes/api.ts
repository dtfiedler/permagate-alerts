import { Router, Response } from 'express';
import { logger } from '../logger.js';
import crypto from 'crypto';
import { Request } from '../types.js';
import * as config from '../config.js';
import { z } from 'zod';
import { NewSubscriber } from '../db/schema.js';

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

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const emailSchema = z.string().email();
    const validatedEmail = emailSchema.safeParse(email);

    if (!validatedEmail.success) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const subscriberData: NewSubscriber = {
      email: validatedEmail.data,
    };
    const subscriber = await req.db.createSubscriber(subscriberData);
    logger.info(`New subscriber added: ${email}`);
    // send intro email in background
    req.notifier.sendRawEmail({
      to: [email],
      text: 'You have successfully been subscribed to alerts.permagate.io!',
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
  '/api/unsubscribe/:email/:hash',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const { email, hash } = req.params;

      if (!email || !hash) {
        return res.status(400).json({ error: 'Email and hash are required' });
      }

      // Verify the hash
      const expectedHash = crypto
        .createHmac('sha256', config.secretKey)
        .update(email)
        .digest('hex');

      if (hash !== expectedHash) {
        logger.warn(`Invalid unsubscribe attempt for email: ${email}`);
        return res.status(400).json({ error: 'Invalid unsubscribe link' });
      }

      const id = 1; // TODO: replace with query to update subscriber
      await req.db.updateSubscriber(id, {
        events: [],
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
