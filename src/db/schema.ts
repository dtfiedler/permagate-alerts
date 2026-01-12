import { z } from 'zod';

export const subscriberEvents = [
  'buy-name-notice',
  'join-network-notice',
  'leave-network-notice',
  'epoch-created-notice',
  'epoch-distribution-notice',
  // 'updated-demand-factor-notice',
  // 'returned-name-notice',
  // 'upgrade-name-notice',
  // 'delegate-stake-notice',
] as const;

export const processEventSubscriptionSchema = z.object({
  eventType: z.string(),
  addresses: z.array(z.string()),
});

export type ProcessEventSubscription = z.infer<
  typeof processEventSubscriptionSchema
>;

export const subscriberEventSchema = z.enum(subscriberEvents);

export type SubscriberEvent = (typeof subscriberEvents)[number];

// Subscriber schema
const subscriberSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  verified: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
  premium: z.boolean().default(false),
});

export type Subscriber = z.infer<typeof subscriberSchema>;

// New subscriber schema (for insertion)
const newSubscriberSchema = subscriberSchema.omit({
  id: true,
  verified: true,
  createdAt: true,
  updatedAt: true,
});

export type NewSubscriber = z.infer<typeof newSubscriberSchema>;

// Process schema
const processSchema = z.object({
  id: z.number(),
  process_id: z.string(),
  name: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type Process = z.infer<typeof processSchema>;

// subscriber to a process schema
const subscribeToProcessSchema = z.object({
  id: z.number(),
  subscriber_id: z.number(),
  process_id: z.string(),
  event_type: z.string(),
  addresses: z.string(),
});

export type SubscribeToProcess = z.infer<typeof subscribeToProcessSchema>;

const newSubscribeToProcessSchema = subscribeToProcessSchema.omit({
  id: true,
});

export type NewSubscribeToProcess = z.infer<typeof newSubscribeToProcessSchema>;

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
    from: z.string().nullable(),
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
  recipient: z.string(),
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

// Webhook types
export const webhookTypes = ['custom', 'discord', 'slack'] as const;
export type WebhookType = (typeof webhookTypes)[number];

// Webhook schema
const webhookSchema = z.object({
  id: z.number(),
  subscriber_id: z.number(),
  url: z.string().url(),
  description: z.string().nullable(),
  type: z.enum(webhookTypes).default('custom'),
  active: z.boolean().default(true),
  last_status: z.enum(['success', 'failed']).nullable(),
  last_error: z.string().nullable(),
  last_triggered_at: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type Webhook = z.infer<typeof webhookSchema>;

// New webhook schema (for insertion)
const newWebhookSchema = webhookSchema.omit({
  id: true,
  last_status: true,
  last_error: true,
  last_triggered_at: true,
  created_at: true,
  updated_at: true,
});

export type NewWebhook = z.infer<typeof newWebhookSchema>;

// DB webhook schema (for database rows)
const dbWebhookSchema = z.object({
  id: z.number(),
  subscriber_id: z.number(),
  url: z.string(),
  description: z.string().nullable(),
  type: z.string(),
  active: z.union([z.boolean(), z.number()]), // SQLite stores as 0/1
  last_status: z.string().nullable(),
  last_error: z.string().nullable(),
  last_triggered_at: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type DBWebhook = z.infer<typeof dbWebhookSchema>;

// Webhook event link schema (join table for webhook <-> event_type)
const webhookEventLinkSchema = z.object({
  id: z.number(),
  webhook_id: z.number(),
  event_type: z.string(),
  created_at: z.date(),
});

export type WebhookEventLink = z.infer<typeof webhookEventLinkSchema>;

// New webhook event link schema (for insertion)
const newWebhookEventLinkSchema = webhookEventLinkSchema.omit({
  id: true,
  created_at: true,
});

export type NewWebhookEventLink = z.infer<typeof newWebhookEventLinkSchema>;

// Export schemas for validation
export const schemas = {
  subscriber: subscriberSchema,
  newSubscriber: newSubscriberSchema,
  event: eventSchema,
  rawEvent: aoRawEventSchema,
  webhookEvent: webhookEventSchema,
  gqlEvent: gqlEventSchema,
  webhook: webhookSchema,
  newWebhook: newWebhookSchema,
};
