import { Router, Response } from 'express';
import { logger } from '../logger.js';
import { Request } from '../types.js';
import * as config from '../config.js';
import { z } from 'zod';
import {
  processEventSubscriptionSchema,
  subscriberEvents,
} from '../db/schema.js';
import {
  generateManageLink,
  generateUnsubscribeLink,
  generateVerifyLink,
  verifyHash,
} from '../lib/hash.js';
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

// Route to check if a subscriber exists
// @ts-ignore
apiRouter.get('/api/subscribers/check', async (req: Request, res: Response) => {
  try {
    const { email } = req.query;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    const subscriber = await req.db.getSubscriberByEmail(email);

    return res.status(200).json({
      exists: !!subscriber,
      premium: !!subscriber?.premium,
    });
  } catch (error) {
    logger.error('Error checking subscriber existence:', error);
    return res
      .status(500)
      .json({ error: 'An error occurred while processing your request' });
  }
});

// Route to manage a subscribers subscription
apiRouter.post(
  '/api/subscribers/manage',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const { email } = req.query;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Email is required' });
      }

      const subscriber = await req.db.getSubscriberByEmail(email);

      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      // generate a link that allows the user to manage their subscription at subscribe.permagate.io
      const manageLink = generateManageLink(email);
      // send a raw email to the user with the manage link
      req.notifier?.sendRawEmail({
        to: [email],
        text: `Please manage your subscription by clicking the link below:\n\n${manageLink}`,
        subject: 'Update your subscription',
      });

      return res.status(200).json({
        message: 'Manage link sent',
      });
    } catch (error) {
      logger.error('Error checking subscriber existence:', error);
      return res
        .status(500)
        .json({ error: 'An error occurred while processing your request' });
    }
  },
);

apiRouter.get(
  '/api/subscribers/manage/:token',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const { token } = req.params;

      if (!token) {
        return res.status(400).json({ error: 'Token is required' });
      }

      const { valid: validHash, decodedEmail } = verifyHash(token);

      if (!validHash) {
        return res.status(400).json({ error: 'Invalid management token' });
      }

      if (!decodedEmail) {
        return res.status(400).json({ error: 'Invalid token format' });
      }

      // Redirect to the management interface with the token as a query parameter
      return res.redirect(
        `${config.frontendUrl}/manage?email=${encodeURIComponent(decodedEmail)}&token=${token}`,
      );
    } catch (error) {
      logger.error('Error processing management link:', error);
      return res
        .status(500)
        .json({ error: 'An error occurred while processing your request' });
    }
  },
);

// Route to get subscriber's subscriptions
apiRouter.get(
  '/api/subscribers/subscriptions',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const email = req.headers['x-user-email'] as string;
      const authHeader = req.headers.authorization;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res
          .status(401)
          .json({ error: 'Authorization token is required' });
      }

      const token = authHeader.split(' ')[1];

      const { valid: validHash, decodedEmail } = verifyHash(token);

      if (!validHash) {
        return res.status(400).json({ error: 'Invalid management token' });
      }

      if (decodedEmail !== email) {
        return res.status(400).json({ error: 'Invalid management token' });
      }

      // Get subscriber data
      const subscriber = await req.db.getSubscriberByEmail(email);

      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      // Get subscriber's subscriptions
      const subscriptions = await req.db.getSubscribedEventsForSubscriber({
        subscriberId: subscriber.id,
      });

      // reduce by processId
      const subscriptionsByProcessId = subscriptions.reduce(
        (acc, subscription) => {
          acc[subscription.processId] = [
            ...(acc[subscription.processId] || []),
            {
              eventType: subscription.eventType,
              addresses: subscription.addresses,
            },
          ];
          return acc;
        },
        {} as Record<string, { eventType: string; addresses: string[] }[]>,
      );
      return res.status(200).json(subscriptionsByProcessId);
    } catch (error) {
      logger.error('Error fetching subscriber subscriptions:', error);
      return res
        .status(500)
        .json({ error: 'An error occurred while processing your request' });
    }
  },
);

// Route to update a subscriber's subscriptions
apiRouter.post(
  '/api/subscribers/update',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const { email, processes, premium } = JSON.parse(req.body);
      const authHeader = req.headers.authorization;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Email is required' });
      }

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization header required' });
      }

      const token = authHeader.split(' ')[1];

      const { valid: validHash, decodedEmail } = verifyHash(token);

      if (!validHash) {
        return res.status(400).json({ error: 'Invalid authorization token' });
      }

      if (decodedEmail !== email) {
        return res.status(400).json({ error: 'Invalid authorization token' });
      }

      // Get subscriber data
      const subscriber = await req.db.getSubscriberByEmail(email);

      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      const processIds = Object.keys(processes);

      if (!processIds.length) {
        return res
          .status(400)
          .json({ error: 'At least one process ID must be provided' });
      }

      if (premium && !subscriber.premium) {
        // TODO: verify in stripe they are premium
        await req.db.updateSubscriber(subscriber.id, {
          premium,
        });
      }

      for (const processId of processIds) {
        // validate the processId is in the list of processes
        if (!(await req.db.getProcessByProcessId(processId))) {
          return res
            .status(400)
            .json({ error: `Invalid process ID ${processId}. Not supported.` });
        }

        const processEventSubscriptions = z.array(
          processEventSubscriptionSchema,
        );
        const validatedEvents = processEventSubscriptions.safeParse(
          processes[processId],
        );

        if (!validatedEvents.success) {
          return res.status(400).json({
            error: `Unsupported event type provided for process ${processId}. ${validatedEvents.error.message}`,
          });
        }

        logger.info(
          `Updating subscription for email to events for process...`,
          {
            email,
            events: validatedEvents.data,
            processId,
          },
        );

        // update the subscriber for the process
        await req.db.updateSubscriberForProcess({
          subscriberId: subscriber.id,
          processId,
          events: validatedEvents.data,
        });

        logger.info(
          `Successfully updated subscription for email to events for process...`,
          {
            email,
            events: validatedEvents.data,
            processId,
          },
        );
      }

      // Get updated subscriptions
      const updatedSubscriptions =
        await req.db.getSubscribedEventsForSubscriber({
          subscriberId: subscriber.id,
        });

      // reduce by processId for response
      const subscriptionsByProcessId = updatedSubscriptions.reduce(
        (acc, subscription) => {
          acc[subscription.processId] = [
            ...(acc[subscription.processId] || []),
            {
              eventType: subscription.eventType,
              addresses: subscription.addresses,
            },
          ];
          return acc;
        },
        {} as Record<string, { eventType: string; addresses: string[] }[]>,
      );

      return res.status(200).json({
        message: 'Subscriptions updated successfully',
        subscriptions: subscriptionsByProcessId,
      });
    } catch (error) {
      logger.error('Error updating subscriber subscriptions:', error);
      return res
        .status(500)
        .json({ error: 'An error occurred while processing your request' });
    }
  },
);

// Route to verify a subscribers email address
apiRouter.get(
  '/api/subscribe/verify/:hash',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const { hash } = req.params;

      const { valid: validHash, decodedEmail } = verifyHash(hash);

      if (!validHash) {
        return res.status(400).json({ error: 'Invalid unsubscribe link' });
      }

      // get the subscriber
      const subscriber = await req.db.getSubscriberByEmail(decodedEmail);

      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
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

      const unsubscribeLink = generateUnsubscribeLink(decodedEmail);
      // send intro email in background
      req.notifier?.sendRawEmail({
        to: [decodedEmail],
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

      const { valid: validHash, decodedEmail } = verifyHash(hash);

      if (!validHash) {
        return res.status(400).json({ error: 'Invalid unsubscribe link' });
      }

      logger.info(`Unsubscribing email: ${decodedEmail}`);

      const subscriber = await req.db.getSubscriberByEmail(decodedEmail);

      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      logger.info(`Verified hash for email: ${decodedEmail}`);

      await req.db.updateSubscriberForProcess({
        subscriberId: subscriber.id,
        processId: ARIO_MAINNET_PROCESS_ID, // TODO: make this dynamic
        events: [], // remove from all events for process
      });

      logger.info(`Unsubscribe request processed for email: ${decodedEmail}`);
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
