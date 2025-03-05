import { EmailProvider } from './email/mailgun.js';
import { GQLEvent, NewEvent, RawEvent } from './db/schema.js';
import { SqliteDatabase } from './db/sqlite.js';
import * as winston from 'winston';

interface IEventProcessor {
  processGQLEvent(event: GQLEvent): Promise<void>;
  processRawEvent(event: RawEvent): Promise<void>;
}

export class EventProcessor implements IEventProcessor {
  private db: SqliteDatabase;
  private notifier: EmailProvider | undefined;
  private logger: winston.Logger;

  constructor({
    db,
    notifier,
    logger,
  }: {
    logger: winston.Logger;
    db: SqliteDatabase;
    notifier?: EmailProvider;
  }) {
    this.db = db;
    this.notifier = notifier;
    this.logger = logger.child({
      module: 'EventProcessor',
    });
  }

  async processGQLEvent(event: GQLEvent): Promise<void> {
    const { tags, data, block } = event;
    const { action, nonce, target, processId } = this.processEventTags(tags);
    if (!action || !nonce || !processId) {
      this.logger.error('No action or nonce or process ID found in event', {
        event,
      });
      return;
    }
    const newEvent: NewEvent = {
      eventType: action,
      eventData: {
        id: event.id,
        target: target || '',
        tags: tags,
        data: data,
      },
      processId: processId,
      blockHeight: block.height,
      nonce: +nonce,
    };
    this.storeAndNotify(newEvent);
  }

  private processEventTags(tags: { name: string; value: string }[]): {
    tags: { name: string; value: string }[];
    nonce: string | undefined;
    action: string | undefined;
    target: string | undefined;
    processId: string | undefined;
  } {
    const nonce = tags.find(
      (tag) => tag.name.startsWith('Reference') || tag.name.startsWith('Ref_'),
    )?.value;
    const target =
      tags.find((tag) => tag.name.startsWith('Target'))?.value ||
      tags.find((tag) => tag.name.startsWith('Pushed-For'))?.value;
    const action = tags
      .find((tag) => tag.name.startsWith('Action'))
      ?.value.toLowerCase();
    const processId = tags.find((tag) => tag.name === 'From-Process')?.value;
    return {
      tags,
      nonce,
      action,
      target,
      processId,
    };
  }

  async processRawEvent(event: RawEvent): Promise<void> {
    for (const message of event.Messages) {
      const { action, nonce, target, tags } = this.processEventTags(
        message.Tags,
      );
      if (!action || !nonce) {
        continue;
      }
      const messageData =
        typeof message.Data === 'string'
          ? (() => {
              try {
                return JSON.parse(message.Data);
              } catch (error) {
                this.logger.error('Error parsing message data', {
                  error,
                  data: message.Data,
                });
                return message.Data;
              }
            })()
          : message.Data;
      const newEvent: NewEvent = {
        eventType: action,
        eventData: {
          id: event.Id,
          target: target || '',
          tags: tags,
          data: messageData,
        },
        processId: 'placeholder', // TODO: add process ID on raw events
        blockHeight: null, // TODO: add block height on raw events
        nonce: +nonce,
      };
      this.storeAndNotify(newEvent);
    }
  }

  private async storeAndNotify(event: NewEvent): Promise<void> {
    const subscribers = await this.db.findSubscribersByEvent(event.eventType);

    // confirm the nonce is greater than the last seen
    const latestEvent = await this.db.getLatestEventByNonce({
      processId: event.processId,
    });
    if (latestEvent && +event.nonce <= latestEvent.nonce) {
      this.logger.info('Skipping event', {
        eventId: event.eventData.id,
        nonce: event.nonce,
        blockHeight: event.blockHeight,
        latestEventNonce: latestEvent.nonce,
        latestEventBlockHeight: latestEvent.blockHeight,
      });
      return;
    }
    // make sure the event is created
    await this.db.createEvent(event);

    this.logger.info('Sending email to subscribers', {
      eventId: event.eventData.id,
      eventType: event.eventType,
      subscribers: subscribers.length,
    });

    if (subscribers.length > 0) {
      // send email, but don't await
      this.notifier
        ?.sendEventEmail({
          to: subscribers.map((subscriber) => subscriber.email),
          subject: getEmailSubjectForEvent(event),
          body: getEmailBodyForEvent(event),
          eventType: event.eventType,
          eventData: event.eventData,
          nonce: event.nonce,
          blockHeight: event.blockHeight,
          processId: event.processId,
        })
        .then(() => this.db.markEventAsProcessed(+event.nonce))
        .catch((error) => {
          this.logger.error('Error sending email', { error });
        });
    } else {
      this.logger.info('No subscribers found for event', {
        eventId: event.eventData.id,
        eventType: event.eventType,
      });
      this.db.markEventAsProcessed(+event.nonce);
    }
  }
}

const getEmailSubjectForEvent = (event: NewEvent) => {
  switch (event.eventType) {
    case 'buy-name-notice':
    case 'buy-record-notice':
      const name = event.eventData.data.name;
      const type = event.eventData.data.type;
      return `✅ ${name} has been ${type === 'permabuy' ? 'permabought' : 'leased'}!`;
    case 'epoch-created-notice':
      return `🔭 Epoch ${event.eventData.data.epochIndex} has been created!`;
    case 'epoch-distribution-notice':
      return `🔭 Epoch ${event.eventData.data.epochIndex} has been distributed!`;
    case 'join-network-notice':
      return `👋 ${event.eventData.data.settings.fqdn} has joined the network!`;
    case 'leave-network-notice':
      return `😢 ${event.eventData.data.settings.fqdn} has left the network!`;
    default:
      return `🚨 New ${event.eventType.replace(/-/g, ' ').toLowerCase()}!`;
  }
};

const getEmailBodyForEvent = (event: NewEvent) => {
  switch (event.eventType.toLowerCase()) {
    case 'buy-name-notice':
    case 'buy-record-notice':
      const name = event.eventData.data.name;
      const type = event.eventData.data.type;
      const startTimestamp = new Date(
        event.eventData.data.startTimestamp,
      ).getTime();
      const endTimestamp =
        type === 'permabuy'
          ? undefined
          : new Date(event.eventData.data.endTimestamp).getTime();
      const getLeaseDurationYears = (
        startTimestamp: number,
        endTimestamp: number | undefined,
      ) => {
        return startTimestamp && endTimestamp
          ? Math.round(
              (endTimestamp - startTimestamp) / (1000 * 60 * 60 * 24 * 365),
            )
          : undefined;
      };
      const leaseDurationYears =
        getLeaseDurationYears(startTimestamp, endTimestamp) || 'Permanent';

      return `
  <div style="padding: 10px; text-align: center; font-family: Arial, sans-serif; color: #333;">
    <h3 style="text-align: center; word-wrap: break-word; color: white;">
      <b>
        <a href="https://${name}.permagate.io" style="color: #007bff; text-decoration: none;">${name}</a>
      </b> 
      was purchased for <b>${event.eventData.data.purchasePrice / 1_000_000} $ARIO</b>!
    </h3>

    <div style="text-align: left; padding: 10px; background: #f8f9fa; border-radius: 5px;">
      <p style="margin: 5px 0;">
        <strong>Owner:</strong> 
        <a href="https://ao.link/#/entity/${event.eventData.target}" style="color: #007bff; text-decoration: none;">
          ${event.eventData.target}
        </a>
      </p>
      <p style="margin: 5px 0;"><strong>Type:</strong> ${event.eventData.data.type}</p>
      <p style="margin: 5px 0;"><strong>Lease Duration:</strong> ${leaseDurationYears ? `${leaseDurationYears} years` : 'Permanent'}</p>
      <p style="margin: 5px 0;">
        <strong>Process ID:</strong> 
        <a href="https://ao.link/#/entity/${event.processId}" style="color: #007bff; text-decoration: none;">
          ${event.processId}
        </a>
      </p>
    </div>

    <br/>

    <a href="https://ao.link/#/message/${event.eventData.id}" 
       style="display: inline-block; background-color: #007bff; color: #ffffff; padding: 10px 15px; border-radius: 5px; text-decoration: none;">
      View on AO
    </a>

    <br/><br/>
  </div>
  `;
    case 'epoch-distribution-notice':
      const epochData = event.eventData.data.distributions;
      const totalEligibleGateways = epochData.totalEligibleGateways || 0;
      const totalEligibleRewards = epochData.totalEligibleRewards
        ? epochData.totalEligibleRewards / 1_000_000
        : 0;
      const totalEligibleObserverReward = epochData.totalEligibleObserverReward
        ? epochData.totalEligibleObserverReward / 1_000_000
        : 0;
      const totalEligibleGatewayReward = epochData.totalEligibleGatewayReward
        ? epochData.totalEligibleGatewayReward / 1_000_000
        : 0;
      const totalDistributedRewards = epochData.totalDistributedRewards
        ? epochData.totalDistributedRewards / 1_000_000
        : 0;
      const distributedTimestamp = epochData.distributedTimestamp
        ? new Date(epochData.distributedTimestamp).toLocaleString()
        : 'N/A';

      return `
  <div style="padding: 10px; text-align: center; font-family: Arial, sans-serif; color: #333;">
    
    <h3 style="text-align: center; word-wrap: break-word;">
      <b>🔍 Epoch ${event.eventData.data.epochIndex} Distribution 💰</b>
    </h3>

    <div style="text-align: left; padding: 10px; background: #f8f9fa; border-radius: 5px;">
      <p style="margin: 5px 0;"><strong>Total Eligible Gateways:</strong> ${totalEligibleGateways}</p>
      <p style="margin: 5px 0;"><strong>Total Eligible Rewards:</strong> ${totalEligibleRewards} $ARIO</p>
      <p style="margin: 5px 0;"><strong>Total Observer Rewards:</strong> ${totalEligibleObserverReward} $ARIO</p>
      <p style="margin: 5px 0;"><strong>Total Gateway Rewards:</strong> ${totalEligibleGatewayReward} $ARIO</p>
      <p style="margin: 5px 0;"><strong>Total Distributed Rewards:</strong> ${totalDistributedRewards} $ARIO (${((totalDistributedRewards / totalEligibleRewards) * 100).toFixed(2)}%)</p>
      <p style="margin: 5px 0;"><strong>Distribution Timestamp:</strong> ${distributedTimestamp}</p>
      <p style="margin: 5px 0;">
        <strong>Process ID:</strong> 
        <a href="https://ao.link/#/entity/${event.processId}" style="color: #007bff; text-decoration: none;">
          ${event.processId}
        </a>
      </p>
    </div>

    <br/>

    <a href="https://ao.link/#/message/${event.eventData.id}" 
       style="display: inline-block; background-color: #007bff; color: #ffffff; padding: 10px 15px; border-radius: 5px; text-decoration: none;">
      View on AO
    </a>

    <br/><br/>
  </div>
  `;
    default:
      return `
  <div style="padding: 10px; text-align: center; font-family: Arial, sans-serif; color: #333;">
    <br/>
    
    <div style="text-align: left; padding: 10px; background: #f8f9fa; border-radius: 5px;">
      <pre style="white-space: pre-wrap; word-wrap: break-word; background: #eef2f7; padding: 10px; border-radius: 5px; max-height: 500px; overflow-y: auto;">
${JSON.stringify(event.eventData.data, null, 2).slice(0, 10000).trim()}
      </pre>
    </div>

    <br/>

    <a href="https://ao.link/#/message/${event.eventData.id}" 
       style="display: inline-block; background-color: #007bff; color: #ffffff; padding: 10px 15px; border-radius: 5px; text-decoration: none;">
      View on AO
    </a>
    <br/>
  </div>
`;
  }
};
