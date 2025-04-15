import Stripe from 'stripe';
import { logger } from '../logger.js';
import { Router, Response } from 'express';
import { Request } from '../types.js';
import * as config from '../config.js';

const stripeRouter = Router();

const stripe = new Stripe(config.stripeSecretKey!, {
  apiVersion: '2025-03-31.basil',
});

// @ts-ignore
stripeRouter.post(
  '/api/stripe/webhook',
  // @ts-ignore
  async (req: Request, res: Response) => {
    logger.debug('Received Stripe webhook', {
      body: req.body,
    });

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers['stripe-signature'] as string,
        config.stripeWebhookSecret!,
      );
    } catch (error: any) {
      logger.error('Error verifying webhook signature', {
        error: error.message,
      });
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    switch (event.type) {
      // charge.succeeded
      case 'charge.succeeded':
        const charge = event.data.object as Stripe.Charge;
        const customer = await stripe.customers.retrieve(
          charge.customer as string,
        );
        if (customer.deleted) {
          logger.error('Customer is deleted', { customer });
          return res.status(400).json({ error: 'Customer is deleted' });
        }
        const customerEmail = customer.email;

        if (!customerEmail) {
          logger.error('No customer email found in charge', { charge });
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
      case 'customer.subscription.created':
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionCustomer = await stripe.customers.retrieve(
          subscription.customer as string,
        );
        if (subscriptionCustomer.deleted) {
          logger.error('Customer is deleted', { subscriptionCustomer });
          return res.status(400).json({ error: 'Customer is deleted' });
        }
        const subscriptionCustomerEmail = subscriptionCustomer.email;

        if (!subscriptionCustomerEmail) {
          logger.error('No customer email found in subscription', {
            subscription,
          });
          return res.status(400).json({ error: 'No customer email provided' });
        }

        try {
          // Check if subscriber exists
          let subscriber = await req.db.getSubscriberByEmail(
            subscriptionCustomerEmail,
          );

          if (subscriber) {
            // Update existing subscriber to premium
            await req.db.updateSubscriber(subscriber.id, {
              id: subscriber.id,
              premium: true,
            });

            logger.info('Updated existing subscriber to premium', {
              email: subscriptionCustomerEmail,
            });
          } else {
            await req.db.createNewSubscriber({
              email: subscriptionCustomerEmail,
              premium: true,
            });
          }
        } catch (error) {
          logger.error('Error processing subscription webhook', {
            error,
            subscriptionCustomerEmail,
          });
        }
        break;
      default:
        logger.info('Received unknown event', { event });
        break;
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

stripeRouter.post(
  '/api/stripe/create-payment-intent',
  // @ts-ignore
  async (req: Request, res: Response) => {
    const { email, priceId } = req.body;

    try {
      // Create a customer first
      const customer = await stripe.customers.create({
        email: email,
        metadata: {
          priceId: priceId,
        },
      });

      // Create the payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 999, // $9.99 in cents
        currency: 'usd',
        customer: customer.id,
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: {
          email: email,
          priceId: priceId,
        },
      });

      res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

stripeRouter.post(
  '/api/stripe/subscription/create',
  // @ts-ignore
  async (req: Request, res: Response) => {
    const { email, priceId } = req.body;

    try {
      // Create a customer
      const customer = await stripe.customers.create({
        email: email,
      });

      // Create a subscription checkout session
      const session = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        metadata: {
          email: email,
        },
        trial_period_days: 7, // 7 day trial
      });

      res.json({ sessionId: session.id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

stripeRouter.get(
  '/api/stripe/subscription/verify',
  // @ts-ignore
  async (req: Request, res: Response) => {
    const { session_id } = req.query as { session_id: string };

    if (!session_id) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (session.payment_status !== 'paid') {
        return res.status(400).json({ error: 'Payment not completed' });
      }

      const subscription = await stripe.subscriptions.retrieve(
        session.subscription as string,
      );

      if (!subscription) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      // Check if subscriber exists
      const subscriber = await req.db.getSubscriberByEmail(
        session.customer_email as string,
      );

      if (subscriber && !subscriber.premium) {
        // Update existing subscriber to premium
        await req.db.updateSubscriber(subscriber.id, {
          id: subscriber.id,
          premium: true,
        });
      }

      res.json({
        status: subscription.status,
        trialEnd: subscription.trial_end,
        startDate: subscription.start_date,
        customerId: subscription.customer,
        premium: subscriber?.premium,
      });
    } catch (error: any) {
      logger.error('Error verifying subscription', {
        error: error.message,
        sessionId: session_id,
      });
      res.status(500).json({ error: error.message });
    }
  },
);

export { stripeRouter };
