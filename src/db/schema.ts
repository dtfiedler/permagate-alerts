import { z } from 'zod';

export const subscriberEvents = [
  'buy-name-notice',
  'join-network-notice',
  'leave-network-notice',
  'updated-demand-factor-notice',
  'epoch-created-notice',
  'epoch-distribution-notice',
  'returned-name-notice',
  'upgrade-name-notice',
  'delegate-stake-notice',
] as const;

export const subscriberEventSchema = z.enum(subscriberEvents);

export type SubscriberEvent = (typeof subscriberEvents)[number];

// Subscriber schema
const subscriberSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  verified: z.boolean().default(false),
  events: z.string().optional(),
  wallet_addresses: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Subscriber = z.infer<typeof subscriberSchema>;

// New subscriber schema (for insertion)
const newSubscriberSchema = subscriberSchema.omit({
  id: true,
  verified: true,
  createdAt: true,
  updatedAt: true,
  wallet_addresses: true,
});

export type NewSubscriber = z.infer<typeof newSubscriberSchema>;

// Alert schema
const eventSchema = z.object({
  id: z.number(),
  processId: z.string(),
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
    id: z.string(),
  }),
  blockHeight: z.number().nullable(),
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
  block_height: z.number().nullable(),
  process_id: z.string(),
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
  Id: z.string(),
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
  Output: z.any(),
  Error: z.any().nullable(),
});

export type RawEvent = z.infer<typeof aoRawEventSchema>;

const gqlEventSchema = z.object({
  id: z.string(),
  tags: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
    }),
  ),
  data: z.string(),
  block: z.object({
    height: z.number().nullable(),
  }),
});

export type GQLEvent = z.infer<typeof gqlEventSchema>;
// Export schemas for validation
export const schemas = {
  subscriber: subscriberSchema,
  newSubscriber: newSubscriberSchema,
  event: eventSchema,
  rawEvent: aoRawEventSchema,
  webhookEvent: webhookEventSchema,
  gqlEvent: gqlEventSchema,
};
