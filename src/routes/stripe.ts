import Stripe from 'stripe';
import { logger } from '../logger.js';
import { Router, Response } from 'express';
import { Request } from '../types.js';
import * as config from '../config.js';

export const stripeRouter = Router();

const stripe = new Stripe(config.stripeSecretKey!, {
  apiVersion: '2025-03-31.basil',
});

// @ts-ignore
stripeRouter.post(
  '/api/stripe/webhook',
  // @ts-ignore
  async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig!,
        config.stripeWebhookSecret!,
      );
    } catch (error: any) {
      logger.error('Error verifying webhook signature', {
        error: error.message,
      });
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    if (event.type === 'customer.subscription.created') {
      const subscription = event.data.object as Stripe.Subscription;
      const customer = await stripe.customers.retrieve(
        subscription.customer as string,
      );
      if (customer.deleted) {
        logger.error('Customer is deleted', { customer });
        return res.status(400).json({ error: 'Customer is deleted' });
      }
      const customerEmail = customer.email;

      if (!customerEmail) {
        logger.error('No customer email found in subscription', {
          subscription,
        });
        return res.status(400).json({ error: 'No customer email provided' });
      }

      try {
        // Check if subscriber exists
        let subscriber = await req.db.getSubscriberByEmail(customerEmail);

        if (subscriber) {
          // Update existing subscriber to premium
          await req.db.updateSubscriber(subscriber.id, {
            id: subscriber.id,
            premium: true,
          });

          logger.info('Updated existing subscriber to premium', {
            email: customerEmail,
          });
        } else {
          await req.db.createNewSubscriber({
            email: customerEmail,
            premium: true,
          });

          logger.info('Created new premium subscriber', {
            email: customerEmail,
          });
        }

        return res.json({ received: true });
      } catch (error) {
        logger.error('Error processing subscription webhook', {
          error,
          customerEmail,
        });
        return res.status(500).json({
          error: 'Error processing subscription',
        });
      }
    }

    // Return 200 for other event types
    res.json({ received: true });
  },
);

stripeRouter.post(
  '/api/stripe/create-checkout-session',
  // @ts-ignore
  async (req: Request, res: Response) => {
    const { email, priceId } = req.body;

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        customer_email: email,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: `${config.frontendUrl}?session_id={CHECKOUT_SESSION_ID}&payment_status=success`,
        cancel_url: `${config.frontendUrl}`,
        metadata: {
          email: email,
        },
      });

      res.json({ sessionId: session.id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

stripeRouter.get(
  '/api/stripe/verify-payment',
  // @ts-ignore
  async (req: Request, res: Response) => {
    const { session_id } = req.query as { session_id: string };

    if (!session_id) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status === 'paid') {
        // Check if subscriber exists
        let subscriber = await req.db.getSubscriberByEmail(
          session.customer_email as string,
        );

        if (subscriber) {
          // Update existing subscriber to premium
          await req.db.updateSubscriber(subscriber.id, {
            id: subscriber.id,
            premium: true,
          });

          logger.info('Updated existing subscriber to premium', {
            email: session.customer_email,
          });
        } else {
          await req.db.createNewSubscriber({
            email: session.customer_email as string,
            premium: true,
          });

          logger.info('Created new premium subscriber', {
            email: session.customer_email as string,
          });
        }

        res.json({ success: true });
      } else {
        res
          .status(400)
          .json({ success: false, message: 'Payment not completed' });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);
