import { Router, type Response } from 'express';
import { logger } from '../logger.js';
import type { Request } from '../types.js';
import * as config from '../config.js';
import { z } from 'zod';
import {
  processEventSubscriptionSchema,
  subscriberEvents,
  webhookTypes,
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
    const decodedEmail = decodeURIComponent(email);
    const { processes = DEFAULT_PROCESS_SUBSCRIPTIONS } = req.body;

    logger.debug('Received subscribe request', {
      email,
      processes,
      body: req.body,
    });

    const emailSchema = z.string().email();

    if (!email || !emailSchema.safeParse(decodedEmail).success) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const processIds = Object.keys(processes);

    if (!processIds.length) {
      return res
        .status(400)
        .json({ error: 'At least one process ID must be provided' });
    }

    let subscriber = await req.db.getSubscriberByEmail(decodedEmail);
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
        email: decodedEmail,
      });

      if (!subscriber) {
        return res.status(500).json({ error: 'Failed to create subscriber' });
      }

      logger.info('Subscribing email to events for process...', {
        email: decodedEmail,
        events: validatedEvents.data,
        processId,
      });

      // update the subscriber for the process
      await req.db.updateSubscriberForProcess({
        subscriberId: subscriber.id,
        processId,
        events: validatedEvents.data,
      });

      logger.info('Successfully subscribed email to events for process...', {
        email: decodedEmail,
        events: validatedEvents.data,
        processId,
      });
    }

    // if the subscriber is not verified, send verification email
    if (!subscriber?.verified) {
      // send verify email
      const verifyLink = generateVerifyLink(decodedEmail);
      await req.mailer?.sendRawEmail({
        to: [decodedEmail],
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

      const unsubscribeLink = generateUnsubscribeLink(decodedEmail);
      // send intro email in background
      req.mailer?.sendRawEmail({
        to: [decodedEmail],
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

      logger.info('Received manage request', {
        email,
      });

      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Email is required' });
      }

      const decodedEmail = decodeURIComponent(email);
      const subscriber = await req.db.getSubscriberByEmail(decodedEmail);

      if (!subscriber) {
        logger.error('Subscriber not found', {
          email: decodedEmail,
        });
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      logger.info('Subscriber found', {
        email: decodedEmail,
        subscriber,
      });

      // generate a link that allows the user to manage their subscription at subscribe.permagate.io
      const manageLink = generateManageLink(decodedEmail);
      // send a raw email to the user with the manage link
      await req.mailer?.sendRawEmail({
        to: [decodedEmail],
        text: `✨ Click here to sign in to your account and manage your subscription: ${manageLink}\n\nThis link is unique to you and will expire in 24 hours.`,
        subject: '✨ Your magic link is ready!',
      });

      logger.info('Manage link sent to email', {
        email: decodedEmail,
        manageLink,
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
      logger.debug('Received subscriber update request', {
        body: req.body,
      });
      const { email, processes, premium } = req.body;
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
          'Updating subscription for email to events for process...',
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
          'Successfully updated subscription for email to events for process...',
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
      req.mailer?.sendRawEmail({
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

// Unified notifications view - table format
apiRouter.get(
  '/api/subscribers/notifications',
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

      if (!validHash || decodedEmail !== email) {
        return res.status(401).json({ error: 'Invalid authorization token' });
      }

      const subscriber = await req.db.getSubscriberByEmail(email);
      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      // Get email subscriptions (event types with addresses)
      const emailSubscriptions = await req.db.getSubscribedEventsForSubscriber({
        subscriberId: subscriber.id,
      });

      // Get webhooks grouped by event type
      const webhooksByEventType =
        await req.db.getWebhooksForSubscriberByEventType(subscriber.id);

      // Build unified table view for all possible event types
      const notifications = subscriberEvents.map((eventType) => {
        // Find email subscription for this event type
        const emailSub = emailSubscriptions.find(
          (s) => s.eventType === eventType,
        );

        return {
          event_type: eventType,
          email_enabled: !!emailSub,
          addresses: emailSub?.addresses || [],
          webhooks: (webhooksByEventType.get(eventType) || []).map((w) => ({
            id: w.id,
            url: w.url,
            description: w.description,
            type: w.type,
            active: w.active,
          })),
        };
      });

      return res.status(200).json(notifications);
    } catch (error) {
      logger.error('Error fetching notifications view:', error);
      return res
        .status(500)
        .json({ error: 'An error occurred while fetching notifications' });
    }
  },
);

// Webhook CRUD routes

// Create a new webhook
apiRouter.post(
  '/api/webhooks',
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

      if (!validHash || decodedEmail !== email) {
        return res.status(401).json({ error: 'Invalid authorization token' });
      }

      const subscriber = await req.db.getSubscriberByEmail(email);
      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      const { url, description, type, active } = req.body;

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL is required' });
      }

      // Validate webhook type if provided
      const webhookType = type || 'custom';
      if (!webhookTypes.includes(webhookType as any)) {
        return res.status(400).json({
          error: `Invalid webhook type. Must be one of: ${webhookTypes.join(', ')}`,
        });
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
      }

      const webhook = await req.db.createWebhook({
        subscriber_id: subscriber.id,
        url,
        description: description || null,
        type: webhookType,
        active: active !== false,
      });

      if (!webhook) {
        return res.status(500).json({ error: 'Failed to create webhook' });
      }

      logger.info('Created webhook', {
        webhookId: webhook.id,
        subscriberId: subscriber.id,
      });

      return res.status(201).json(webhook);
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({
          error: 'A webhook with this URL already exists',
        });
      }
      logger.error('Error creating webhook:', error);
      return res
        .status(500)
        .json({ error: 'An error occurred while creating the webhook' });
    }
  },
);

// List webhooks for subscriber
apiRouter.get(
  '/api/webhooks',
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

      if (!validHash || decodedEmail !== email) {
        return res.status(401).json({ error: 'Invalid authorization token' });
      }

      const subscriber = await req.db.getSubscriberByEmail(email);
      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      const webhooks = await req.db.getWebhooksForSubscriber(subscriber.id);

      return res.status(200).json(webhooks);
    } catch (error) {
      logger.error('Error listing webhooks:', error);
      return res
        .status(500)
        .json({ error: 'An error occurred while listing webhooks' });
    }
  },
);

// Update a webhook
apiRouter.put(
  '/api/webhooks/:id',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const email = req.headers['x-user-email'] as string;
      const authHeader = req.headers.authorization;
      const webhookId = parseInt(req.params.id, 10);

      if (isNaN(webhookId)) {
        return res.status(400).json({ error: 'Invalid webhook ID' });
      }

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

      if (!validHash || decodedEmail !== email) {
        return res.status(401).json({ error: 'Invalid authorization token' });
      }

      const subscriber = await req.db.getSubscriberByEmail(email);
      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      // Verify the webhook belongs to this subscriber
      const existingWebhook = await req.db.getWebhook(webhookId);
      if (!existingWebhook) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      if (existingWebhook.subscriber_id !== subscriber.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { url, description, type, active } = req.body;

      const updates: Record<string, any> = {};

      if (url !== undefined) {
        if (typeof url !== 'string') {
          return res.status(400).json({ error: 'Invalid URL' });
        }
        try {
          new URL(url);
        } catch {
          return res.status(400).json({ error: 'Invalid URL format' });
        }
        updates.url = url;
      }

      if (description !== undefined) {
        updates.description = description;
      }

      if (type !== undefined) {
        if (!webhookTypes.includes(type as any)) {
          return res.status(400).json({
            error: `Invalid webhook type. Must be one of: ${webhookTypes.join(', ')}`,
          });
        }
        updates.type = type;
      }

      if (active !== undefined) {
        updates.active = Boolean(active);
      }

      const updatedWebhook = await req.db.updateWebhook(webhookId, updates);

      logger.info('Updated webhook', {
        webhookId,
        subscriberId: subscriber.id,
        updates: Object.keys(updates),
      });

      return res.status(200).json(updatedWebhook);
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({
          error: 'A webhook with this URL already exists',
        });
      }
      logger.error('Error updating webhook:', error);
      return res
        .status(500)
        .json({ error: 'An error occurred while updating the webhook' });
    }
  },
);

// Delete a webhook
apiRouter.delete(
  '/api/webhooks/:id',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const email = req.headers['x-user-email'] as string;
      const authHeader = req.headers.authorization;
      const webhookId = parseInt(req.params.id, 10);

      if (isNaN(webhookId)) {
        return res.status(400).json({ error: 'Invalid webhook ID' });
      }

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

      if (!validHash || decodedEmail !== email) {
        return res.status(401).json({ error: 'Invalid authorization token' });
      }

      const subscriber = await req.db.getSubscriberByEmail(email);
      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      // Verify the webhook belongs to this subscriber
      const existingWebhook = await req.db.getWebhook(webhookId);
      if (!existingWebhook) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      if (existingWebhook.subscriber_id !== subscriber.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      await req.db.deleteWebhook(webhookId);

      logger.info('Deleted webhook', {
        webhookId,
        subscriberId: subscriber.id,
      });

      return res.status(200).json({ message: 'Webhook deleted successfully' });
    } catch (error) {
      logger.error('Error deleting webhook:', error);
      return res
        .status(500)
        .json({ error: 'An error occurred while deleting the webhook' });
    }
  },
);

// Webhook Events (linking) routes

// Get linked event types for a webhook
apiRouter.get(
  '/api/webhooks/:id/events',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const email = req.headers['x-user-email'] as string;
      const authHeader = req.headers.authorization;
      const webhookId = parseInt(req.params.id, 10);

      if (isNaN(webhookId)) {
        return res.status(400).json({ error: 'Invalid webhook ID' });
      }

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

      if (!validHash || decodedEmail !== email) {
        return res.status(401).json({ error: 'Invalid authorization token' });
      }

      const subscriber = await req.db.getSubscriberByEmail(email);
      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      const webhook = await req.db.getWebhook(webhookId);
      if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      if (webhook.subscriber_id !== subscriber.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const eventTypes = await req.db.getWebhookEvents(webhookId);

      return res.status(200).json({ event_types: eventTypes });
    } catch (error) {
      logger.error('Error getting webhook events:', error);
      return res
        .status(500)
        .json({ error: 'An error occurred while getting webhook events' });
    }
  },
);

// Set/update linked event types for a webhook
apiRouter.post(
  '/api/webhooks/:id/events',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const email = req.headers['x-user-email'] as string;
      const authHeader = req.headers.authorization;
      const webhookId = parseInt(req.params.id, 10);

      if (isNaN(webhookId)) {
        return res.status(400).json({ error: 'Invalid webhook ID' });
      }

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

      if (!validHash || decodedEmail !== email) {
        return res.status(401).json({ error: 'Invalid authorization token' });
      }

      const subscriber = await req.db.getSubscriberByEmail(email);
      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      const webhook = await req.db.getWebhook(webhookId);
      if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      if (webhook.subscriber_id !== subscriber.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { event_types } = req.body;

      if (!Array.isArray(event_types)) {
        return res.status(400).json({ error: 'event_types must be an array' });
      }

      // Validate all event types
      for (const eventType of event_types) {
        if (!subscriberEvents.includes(eventType as any)) {
          return res.status(400).json({
            error: `Invalid event type: ${eventType}. Must be one of: ${subscriberEvents.join(', ')}`,
          });
        }
      }

      await req.db.setWebhookEvents(webhookId, event_types);

      logger.info('Updated webhook events', {
        webhookId,
        subscriberId: subscriber.id,
        eventTypes: event_types,
      });

      return res.status(200).json({
        message: 'Webhook events updated successfully',
        event_types,
      });
    } catch (error) {
      logger.error('Error setting webhook events:', error);
      return res
        .status(500)
        .json({ error: 'An error occurred while setting webhook events' });
    }
  },
);

// Remove a single event type from a webhook
apiRouter.delete(
  '/api/webhooks/:id/events/:eventType',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const email = req.headers['x-user-email'] as string;
      const authHeader = req.headers.authorization;
      const webhookId = parseInt(req.params.id, 10);
      const eventType = req.params.eventType;

      if (isNaN(webhookId)) {
        return res.status(400).json({ error: 'Invalid webhook ID' });
      }

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

      if (!validHash || decodedEmail !== email) {
        return res.status(401).json({ error: 'Invalid authorization token' });
      }

      const subscriber = await req.db.getSubscriberByEmail(email);
      if (!subscriber) {
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      const webhook = await req.db.getWebhook(webhookId);
      if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      if (webhook.subscriber_id !== subscriber.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const deleted = await req.db.removeWebhookEvent(webhookId, eventType);

      if (!deleted) {
        return res.status(404).json({ error: 'Event type not linked to webhook' });
      }

      logger.info('Removed webhook event', {
        webhookId,
        subscriberId: subscriber.id,
        eventType,
      });

      return res.status(200).json({ message: 'Event type removed from webhook' });
    } catch (error) {
      logger.error('Error removing webhook event:', error);
      return res
        .status(500)
        .json({ error: 'An error occurred while removing webhook event' });
    }
  },
);

// Admin route to reprocess events for specific channels
apiRouter.post(
  '/api/admin/reprocess',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const { channel, eventId, nonce } = req.body;
      const adminKey = req.headers['x-admin-key'] as string;

      // Validate admin key
      if (!adminKey || adminKey !== config.adminApiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Validate required parameters
      if (!channel) {
        return res.status(400).json({ error: 'Channel is required' });
      }

      // Either eventId (database ID) or nonce is required
      if (!eventId && !nonce) {
        return res.status(400).json({ error: 'Either eventId or nonce is required' });
      }

      logger.info('Processing reprocess request', {
        channel,
        eventId,
        nonce,
      });

      // Get the event from database
      let event;
      if (nonce) {
        event = await req.db.getEvent(+nonce);
      } else if (eventId) {
        // If using eventId, we need a different method - for now use nonce
        return res.status(400).json({ error: 'Use nonce parameter instead of eventId' });
      }

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      logger.info('Found event for reprocessing', {
        eventNonce: event.nonce,
        eventType: event.eventType,
        processId: event.processId,
      });

      // Determine which notification channel to reprocess
      const validChannels = ['email', 'discord', 'slack', 'twitter', 'webhook', 'all'];
      if (!validChannels.includes(channel)) {
        return res.status(400).json({
          error: `Invalid channel. Must be one of: ${validChannels.join(', ')}`,
        });
      }

      // Create a filtered notification provider based on channel
      let targetProvider;
      const { notificationProvider } = await import('../system.js');

      if (channel === 'all') {
        targetProvider = notificationProvider;
      } else {
        // For specific channels, we'd need to create individual providers
        // This is a simplified approach - you might want to refactor the system
        // to support more granular channel selection
        targetProvider = notificationProvider;
        logger.warn('Channel-specific reprocessing not yet implemented, using all channels', {
          requestedChannel: channel,
        });
      }

      // Reprocess the notification
      await targetProvider.handle({ event, recipients: [] });

      logger.info('Successfully reprocessed event', {
        eventNonce: event.nonce,
        eventType: event.eventType,
        channel,
      });

      return res.status(200).json({
        message: 'Event reprocessed successfully',
        event: {
          nonce: event.nonce,
          eventType: event.eventType,
          processId: event.processId,
          channel: channel,
        },
      });
    } catch (error) {
      logger.error('Error reprocessing event:', error);
      return res.status(500).json({
        error: 'An error occurred while reprocessing the event',
      });
    }
  },
);

export { apiRouter };
