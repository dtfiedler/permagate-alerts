# Notification System

This module provides a unified notification system for Permagate Alerts, allowing for sending notifications across multiple channels with a single interface.

## Overview

The notification system follows a provider pattern, where each channel (email, Slack, webhooks) implements the `NotificationProvider` interface. A composite provider combines all enabled providers to send notifications through multiple channels at once.

## Key Components

### NotificationProvider Interface

The core interface that all notification providers must implement:

```typescript
interface NotificationProvider {
  handle(data: NotificationData): Promise<void>;
}
```

### Available Providers

1. **EmailNotificationProvider**: Sends email notifications using the configured email service (currently Mailgun)
2. **SlackNotificationProvider**: Posts notifications to a Slack channel via webhook
3. **WebhookNotificationProvider**: Sends notification data to configurable HTTP endpoints

### CompositeNotificationProvider

Combines multiple providers into a single unified provider that distributes notifications to all enabled channels.

### Content Generation

The `generateNotificationContent` function creates content appropriate for all notification channels based on event data.

## Configuration

Configure notification providers in your environment variables:

```
# Email (Mailgun)
MAILGUN_API_KEY=your-api-key
MAILGUN_DOMAIN=your-domain
MAILGUN_FROM_EMAIL=noreply@example.com
DISABLE_EMAILS=false

# Slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/your/webhook/url
ENABLE_SLACK_NOTIFICATIONS=true

# Webhooks (JSON array of endpoints with optional headers)
WEBHOOK_ENDPOINTS=[{"url":"https://example.com/hook","headers":{"Authorization":"Bearer token"}}]
```

## Usage Example

The notification system is automatically initialized in `system.ts` and injected into the `EventProcessor`. When events occur, the processor will generate appropriate content for each channel and distribute notifications.

### Adding a New Provider

To add a new notification provider:

1. Create a new implementation of the `NotificationProvider` interface
2. Add configuration options to `config.ts`
3. Initialize the provider in `system.ts`
4. Add it to the `CompositeNotificationProvider`

### Manual Usage

You can also use the notification system directly:

```typescript
import { notificationProvider } from './system.js';
import { generateNotificationContent } from './notifications/index.js';

// Generate content for an event
const notificationData = await generateNotificationContent(
  event,
  recipients,
  logger,
);

// Send to all configured channels
await notificationProvider.handle(notificationData);
```
