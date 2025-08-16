import { Logger } from 'winston';
import {
  NotificationData,
  NotificationProvider,
  NotificationProviderOptions,
} from './interface.js';
import { getEmailSubjectForEvent, getNotificationFields } from './content.js';

export interface TwitterNotificationProviderOptions
  extends NotificationProviderOptions {
  bearerToken: string;
}

export class TwitterNotificationProvider implements NotificationProvider {
  private bearerToken: string;
  private logger: Logger;
  private enabled: boolean;

  constructor({
    bearerToken,
    logger,
    enabled = true,
  }: TwitterNotificationProviderOptions) {
    this.bearerToken = bearerToken;
    this.logger = logger.child({
      module: 'TwitterNotificationProvider',
    });
    this.enabled = enabled;
  }

  async handle(data: NotificationData): Promise<void> {
    if (!this.enabled) {
      this.logger.info('Twitter notifications are disabled');
      return;
    }

    try {
      const header = await getEmailSubjectForEvent(data.event);
      const fields = await getNotificationFields(data.event);

      // Format fields as text for Twitter
      const fieldsText = fields
        .map((field) => `${field.key}: ${field.value}`)
        .join('\n');

      // Combine header and fields
      let tweetContent = `${header}\n\n${fieldsText}`;

      // Handle Twitter's character limit (280 characters)
      if (tweetContent.length > 280) {
        // Try to fit the header and as many fields as possible
        let truncatedContent = header;
        const availableSpace = 280 - header.length - 3; // -3 for "..."
        
        if (availableSpace > 10) { // Only add fields if we have meaningful space
          truncatedContent += '\n\n';
          let remainingSpace = availableSpace - 2; // -2 for the newlines
          
          for (const field of fields) {
            const fieldText = `${field.key}: ${field.value}`;
            if (fieldText.length + 1 <= remainingSpace) { // +1 for newline
              truncatedContent += fieldText + '\n';
              remainingSpace -= fieldText.length + 1;
            } else {
              break;
            }
          }
          
          // Remove trailing newline and add ellipsis
          truncatedContent = truncatedContent.trim() + '...';
        }
        
        tweetContent = truncatedContent;
      }

      // Post tweet using Twitter API v2
      await this.postTweet(tweetContent);

      this.logger.debug('Twitter notification sent successfully', {
        eventType: data.event.eventType,
        tweetLength: tweetContent.length,
      });
    } catch (error) {
      this.logger.error('Failed to send Twitter notification', {
        error,
        eventType: data.event.eventType,
      });
      throw error;
    }
  }

  private async postTweet(text: string): Promise<void> {
    this.logger.debug('Posting tweet', {
      textLength: text.length,
    });

    // Use Twitter API v2 to post tweet
    const response = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Twitter API request failed: ${response.status} ${response.statusText}. ${JSON.stringify(errorData)}`
      );
    }

    const result = await response.json();
    this.logger.debug('Tweet posted successfully', {
      tweetId: result.data?.id,
    });
  }
}