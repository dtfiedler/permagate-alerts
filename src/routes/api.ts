import { Router, Response } from 'express';
import { logger } from '../logger.js';
import crypto from 'crypto';
import { Request } from '../types.js';
import * as config from '../config.js';
import { z } from 'zod';
import {
  processEventSubscriptionSchema,
  subscriberEvents,
} from '../db/schema.js';
import { generateUnsubscribeLink, generateVerifyLink } from '../lib/hash.js';
import { ARIO_MAINNET_PROCESS_ID } from '@ar.io/sdk';

const apiRouter = Router();

const DEFAULT_PROCESS_SUBSCRIPTIONS = {
  [ARIO_MAINNET_PROCESS_ID]: [
    ...subscriberEvents.map((event) => ({
      eventType: event,
      addresses: [],
    })),
  ],
};

// Healthcheck
apiRouter.get('/healthcheck', (_, res) => {
  res.send('OK');
});

// Route to add a new subscriber
// @ts-ignore
apiRouter.post('/api/subscribe', async (req: Request, res: Response) => {
  try {
    const email = req.query.email as string;
    const { processes = DEFAULT_PROCESS_SUBSCRIPTIONS } = JSON.parse(req.body);

    logger.debug(`Received subscribe request`, {
      email,
      processes,
      body: req.body,
    });

    const emailSchema = z.string().email();

    if (!email || !emailSchema.safeParse(email).success) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const processIds = Object.keys(processes);

    if (!processIds.length) {
      return res
        .status(400)
        .json({ error: 'At least one process ID must be provided' });
    }

    let subscriber = await req.db.getSubscriberByEmail(email);
    for (const processId of processIds) {
      // validate the processId is in the list of processes
      if (!(await req.db.getProcessByProcessId(processId))) {
        return res
          .status(400)
          .json({ error: `Invalid process ID ${processId}. Not supported.` });
      }

      const processEventSubscriptions = z.array(processEventSubscriptionSchema);
      const validatedEvents = processEventSubscriptions.safeParse(
        processes[processId],
      );

      if (!validatedEvents.success) {
        return res.status(400).json({
          error: `Unsupported event type provided for process ${processId}. ${validatedEvents.error.message}`,
        });
      }

      subscriber ??= await req.db.createNewSubscriber({
        email,
      });

      if (!subscriber) {
        return res.status(500).json({ error: 'Failed to create subscriber' });
      }

      logger.info(`Subscribing email to events for process...`, {
        email,
        events: validatedEvents.data,
        processId,
      });

      // update the subscriber for the process
      await req.db.updateSubscriberForProcess({
        subscriberId: subscriber.id,
        processId,
        events: validatedEvents.data,
      });

      logger.info(`Successfully subscribed email to events for process...`, {
        email,
        events: validatedEvents.data,
        processId,
      });
    }

    // if the subscriber is not verified, send verification email
    if (!subscriber?.verified) {
      // send verify email
      const verifyLink = generateVerifyLink(email);
      req.notifier?.sendRawEmail({
        to: [email],
        text: `Please verify your email address by clicking the link below:\n\n${verifyLink}`,
        subject: '🤖 Verify your email address',
      });
    } else {
      const eventsForSubscriber = await req.db.getSubscribedEventsForSubscriber(
        {
          subscriberId: subscriber.id,
        },
      );

      const eventSubscriptionsPerProcess = eventsForSubscriber.reduce(
        (acc, event) => {
          acc[event.processId] = [
            ...(acc[event.processId] || []),
            event.eventType,
          ];
          return acc;
        },
        {} as Record<string, string[]>,
      );

      const unsubscribeLink = generateUnsubscribeLink(email);
      // send intro email in background
      req.notifier?.sendRawEmail({
        to: [email],
        text: `You have successfully updated your subscription to subscribe.permagate.io!

You will receive alerts for the following: 

${Object.entries(eventSubscriptionsPerProcess)
  .map(
    ([processId, eventTypes]) =>
      `Process ID: ${processId}\n${eventTypes.map((eventType) => `- ${eventType}`).join('\n')}`,
  )
  .join('\n\n')}
          
To unsubscribe, click here: ${unsubscribeLink}`,
        subject: 'Subscription successful! 🚀',
      });
      return res.status(200).json({
        message: 'Subscriber verified',
      });
    }

    return res.status(200).json({
      message: `Subscriber ${subscriber?.verified ? 'updated' : 'created'}`,
    });
  } catch (error) {
    logger.error('Error processing subscribe request:', error);
    res
      .status(500)
      .json({ error: 'An error occurred while processing your request' });
  }
});

// Route to verify a subscribers email address
apiRouter.get(
  '/api/subscribe/verify/:hash',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const { hash } = req.params;

      // parse out the email from the hash
      const [encodedEmail, givenHmac] = hash.split('.');
      const email = Buffer.from(encodedEmail, 'base64url').toString('utf8');

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      // verify the hash
      const expectedHmacForEmail = crypto
        .createHmac('sha256', config.secretKey)
        .update(email)
        .digest('hex');

      const givenHmacBuffer = new Uint8Array(Buffer.from(givenHmac, 'hex'));
      const expectedHmacBuffer = new Uint8Array(
        Buffer.from(expectedHmacForEmail, 'hex'),
      );

      if (!crypto.timingSafeEqual(givenHmacBuffer, expectedHmacBuffer)) {
        return res.status(400).json({ error: 'Invalid unsubscribe link' });
      }

      // get the subscriber
      const subscriber = await req.db.getSubscriberByEmail(email);

      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      // verify the subscriber
      if (subscriber.email !== email) {
        return res.status(400).json({ error: 'Invalid unsubscribe link' });
      }

      const verified = await req.db.verifySubscriber(subscriber.id);

      // verify the subscriber is verified
      if (!verified?.verified) {
        return res.status(400).json({ error: 'Subscriber not verified' });
      }

      // get the events and process for the subscriber
      const eventsForSubscriber = await req.db.getSubscribedEventsForSubscriber(
        {
          subscriberId: subscriber.id,
        },
      );

      const unsubscribeLink = generateUnsubscribeLink(email);
      // send intro email in background
      req.notifier?.sendRawEmail({
        to: [email],
        text: `You have successfully been subscribed to subscribe.permagate.io!

You will receive alerts for the following: ${eventsForSubscriber
          .map(({ eventType, processId }) => `${eventType} for ${processId}`)
          .join(', ')}

To unsubscribe, click here: ${unsubscribeLink}`,
        subject: 'Subscription successful! 🚀',
      });
      return res.status(200).json({
        message: 'Subscriber verified',
      });
    } catch (error) {
      logger.error('Error processing subscribe request:', error);
      res
        .status(500)
        .json({ error: 'An error occurred while processing your request' });
    }

    return res.status(200).json({ message: 'Subscriber verified' });
  },
);

// Route to get the total number of subscribers
// @ts-ignore
apiRouter.get('/api/subscribers/total', async (req: Request, res: Response) => {
  const total = await req.db.getTotalSubscribers();
  return res.status(200).json({ total });
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

      await req.db.updateSubscriberForProcess({
        subscriberId: subscriber.id,
        processId: ARIO_MAINNET_PROCESS_ID, // TODO: make this dynamic
        events: [], // remove from all events for process
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
