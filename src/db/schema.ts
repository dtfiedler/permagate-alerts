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
  eventData: z.object({
    tags: z.array(
      z.object({
        name: z.string(),
        value: z.string(),
      }),
    ),
    data: z.any(),
    target: z.string(),
  }),
  nonce: z.number(),
  emailsSent: z.boolean(),
  createdAt: z.date(),
  processedAt: z.date().nullable(),
});

export type Event = z.infer<typeof eventSchema>;
const dbEventSchema = z.object({
  id: z.number(),
  event_type: z.string(),
  event_data: z.string(),
  nonce: z.number(),
  emails_sent: z.boolean().default(false),
  created_at: z.date(),
  processed_at: z.date().nullable(),
});
export type DBEvent = z.infer<typeof dbEventSchema>;

// new event schema (for insertion)
const newEventSchema = eventSchema.omit({
  id: true,
  createdAt: true,
  emailsSent: true,
  processedAt: true,
});

export type NewEvent = z.infer<typeof newEventSchema>;

const webhookEventSchema = z.object({
  data: z.object({
    id: z.string(),
    tags: z.array(
      z.object({
        name: z.string(),
        value: z.string(),
      }),
    ),
    data_hash: z.string(),
    data_offset: z.number(),
    data_size: z.number(),
    filter: z.string(),
    target: z.string(),
  }),
  event: z.string(),
});

export type WebhookEvent = z.infer<typeof webhookEventSchema>;

// New alert schema (for insertion)
const aoRawEventSchema = z.object({
  Messages: z.array(
    z.object({
      Tags: z.array(
        z.object({
          name: z.string(),
          value: z.string(),
        }),
      ),
      Data: z.string(),
    }),
  ),
  Output: z.string(),
  Error: z.string().nullable(),
});

export type RawEvent = z.infer<typeof aoRawEventSchema>;

// Export schemas for validation
export const schemas = {
  subscriber: subscriberSchema,
  newSubscriber: newSubscriberSchema,
  event: eventSchema,
  rawEvent: aoRawEventSchema,
  webhookEvent: webhookEventSchema,
};
