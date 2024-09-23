import { z } from 'zod';

// Subscriber schema
const subscriberSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  events: z.array(
    z.enum([
      'buy-record-notice',
      'name-expiration-notice',
      'distribution-notice',
      'save-observations-notice',
    ]),
  ),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Subscriber = z.infer<typeof subscriberSchema>;

// New subscriber schema (for insertion)
const newSubscriberSchema = subscriberSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  events: true,
});

export type NewSubscriber = z.infer<typeof newSubscriberSchema>;

// Alert schema
const eventSchema = z.object({
  id: z.number(),
  eventType: z.string(),
  eventData: z.record(z.unknown()),
  nonce: z.number(),
  emailsSent: z.boolean(),
  createdAt: z.date(),
  processedAt: z.date().nullable(),
});

export type Event = z.infer<typeof eventSchema>;

// New alert schema (for insertion)
const newEventSchema = eventSchema.omit({
  id: true,
  emailsSent: true,
  createdAt: true,
  processedAt: true,
});

export type NewEvent = z.infer<typeof newEventSchema>;

// Export schemas for validation
export const schemas = {
  subscriber: subscriberSchema,
  newSubscriber: newSubscriberSchema,
  event: eventSchema,
  newEvent: newEventSchema,
};
