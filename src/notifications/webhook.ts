import { Logger } from 'winston';
import {
  NotificationData,
  NotificationProvider,
  NotificationProviderOptions,
} from './interface.js';
import axios from 'axios';

export interface WebhookRecipient {
  url: string;
  headers?: Record<string, string>;
}

export interface WebhookNotificationProviderOptions
  extends NotificationProviderOptions {
  endpoints?: WebhookRecipient[];
}

export class WebhookNotificationProvider implements NotificationProvider {
  private endpoints: WebhookRecipient[];
  private logger: Logger;
  private enabled: boolean;

  constructor({
    endpoints = [],
    logger,
    enabled = true,
  }: WebhookNotificationProviderOptions) {
    this.endpoints = endpoints;
    this.logger = logger.child({
      module: 'WebhookNotificationProvider',
    });
    this.enabled = enabled;
  }

  /**
   * Add a new webhook endpoint
   */
  addEndpoint(endpoint: WebhookRecipient): void {
    this.endpoints.push(endpoint);
  }

  /**
   * Remove a webhook endpoint by URL
   */
  removeEndpoint(url: string): void {
    this.endpoints = this.endpoints.filter((endpoint) => endpoint.url !== url);
  }

  async handle(data: NotificationData): Promise<void> {
    if (!this.enabled) {
      this.logger.info('Webhook notifications are disabled');
      return;
    }

    // No webhooks configured
    if (this.endpoints.length === 0) {
      this.logger.debug(
        'No webhook endpoints configured, skipping webhook notifications',
      );
      return;
    }

    // Prepare payload with all relevant data
    const payload = {
      eventType: data.event.eventType,
      processId: data.event.processId,
      nonce: data.event.nonce,
      blockHeight: data.event.blockHeight,
      eventData: data.event.eventData,
    };

    // Send to all configured endpoints
    const promises = this.endpoints.map(async (endpoint) => {
      try {
        this.logger.debug('Sending webhook notification', {
          url: endpoint.url,
          eventType: data.event.eventType,
        });

        await axios.post(endpoint.url, payload, {
          headers: {
            'Content-Type': 'application/json',
            ...endpoint.headers,
          },
        });

        this.logger.debug('Webhook notification sent successfully', {
          url: endpoint.url,
          eventType: data.event.eventType,
        });
      } catch (error) {
        this.logger.error('Failed to send webhook notification', {
          error,
          url: endpoint.url,
          eventType: data.event.eventType,
        });
      }
    });

    await Promise.all(promises);
  }
}
