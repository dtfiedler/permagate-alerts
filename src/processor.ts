import { EmailProvider } from './email/mailgun.js';
import { GQLEvent, NewEvent, RawEvent } from './db/schema.js';
import { SqliteDatabase } from './db/sqlite.js';
import * as winston from 'winston';
import { AOProcess, ARIO, ARIO_MAINNET_PROCESS_ID } from '@ar.io/sdk';
import { connect } from '@permaweb/aoconnect';
import * as config from './config.js';
const ario = ARIO.init({
  process: new AOProcess({
    processId: config.arioProcessId || ARIO_MAINNET_PROCESS_ID,
    ao: connect({
      CU_URL: 'https://cu.ardrive.io',
    }),
  }),
});

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
          body: await getEmailBodyForEvent(event),
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
      return `💰 Epoch ${event.eventData.data.epochIndex} has been distributed!`;
    case 'join-network-notice':
      return `👋 ${event.eventData.data.settings.fqdn} has joined the network!`;
    case 'leave-network-notice':
      return `😢 ${event.eventData.data.settings.fqdn} has left the network!`;
    default:
      return `🚨 New ${event.eventType.replace(/-/g, ' ').toLowerCase()}!`;
  }
};

const getEmailBodyForEvent = async (event: NewEvent) => {
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
    <br/>
    <br/>
    <a href="https://subscribe.permagate.io/" style="color: #ffffff; text-decoration: none;">subscribe.permagate.io</a>
    <br/>
  </div>
  `;
    case 'join-network-notice':
      return `
  <div style="padding: 10px; text-align: center; font-family: Arial, sans-serif; color: #333;">
    <div style="text-align: left; padding: 10px; background: #f8f9fa; border-radius: 5px;">
      <p style="margin: 5px 0;"><strong>FQDN:</strong> ${event.eventData.data.settings.fqdn}</p>
      <p style="margin: 5px 0;"><strong>Operator Stake:</strong> ${event.eventData.data.operatorStake ? event.eventData.data.operatorStake / 1_000_000 + ' $ARIO' : 'N/A'}</p>
      <p style="margin: 5px 0;"><strong>Allows Delegated Staking:</strong> ${event.eventData.data.settings.allowDelegatedStaking ? 'Yes' : 'No'}</p>
      <p style="margin: 5px 0;"><strong>Minimum Delegated Stake:</strong> ${event.eventData.data.settings.allowDelegatedStaking ? event.eventData.data.settings.minDelegatedStake / 1_000_000 + ' $ARIO' : 'N/A'}</p>
      <p style="margin: 5px 0;"><strong>Delegate Reward Percentage:</strong> ${event.eventData.data.settings.allowDelegatedStaking ? event.eventData.data.settings.delegateRewardShareRatio.toFixed(2) + '%' : 'N/A'}</p>
      <p style="margin: 5px 0;">
        <strong>Gateway Address:</strong> 
        <a href="https://ao.link/#/entity/${event.eventData.target}" style="color: #007bff; text-decoration: none;">
          ${event.eventData.target}
        </a>
      </p>
      <p style="margin: 5px 0;">
        <strong>Observer Address:</strong> 
        <a href="https://ao.link/#/entity/${event.eventData.data.observerAddress}" style="color: #007bff; text-decoration: none;">
          ${event.eventData.data.observerAddress}
        </a>
      </p>
    </div>

    <br/>

    <a href="https://ao.link/#/message/${event.eventData.id}" 
       style="display: inline-block; background-color: #007bff; color: #ffffff; padding: 10px 15px; border-radius: 5px; text-decoration: none;">
      View on AO
    </a>  
    <br/>
    <br/>
    <a href="https://subscribe.permagate.io/" style="color: #ffffff; text-decoration: none;">subscribe.permagate.io</a>
    <br/>
  </div>
  `;
    case 'epoch-created-notice':
      const epochIndex = event.eventData.data.epochIndex;
      const epochStartTimestamp = event.eventData.data.startTimestamp;
      const epochEndTimestamp = event.eventData.data.endTimestamp;

      const totalEligibleGatewaysCreated =
        event.eventData.data.distributions.totalEligibleGateways;
      const totalEligibleObserverRewardCreated =
        event.eventData.data.distributions.totalEligibleObserverReward /
        1_000_000;
      const totalEligibleGatewayRewardCreated =
        event.eventData.data.distributions.totalEligibleGatewayReward /
        1_000_000;

      const prescribedObservers: Record<string, string> =
        event.eventData.data.prescribedObservers;
      const prescribedGatewayAddresses = Object.values(prescribedObservers);
      const prescribedNames = event.eventData.data.prescribedNames;

      const prescribedGatewayFqdns: Record<string, string> = {};
      for (const gatewayAddress of prescribedGatewayAddresses) {
        const gateway = await ario
          .getGateway({
            address: gatewayAddress,
          })
          .catch(() => undefined);

        prescribedGatewayFqdns[gatewayAddress] =
          gateway?.settings?.fqdn || 'N/A';
      }

      return `
  <div style="padding: 10px; text-align: center; font-family: Arial, sans-serif; color: #333;">
    <div style="text-align: left; padding: 10px; background: #f8f9fa; border-radius: 5px;">
      <p style="margin: 5px 0;"><strong>Epoch Index:</strong> ${epochIndex}</p>
      <p style="margin: 5px 0;"><strong>Start Timestamp:</strong> ${epochStartTimestamp ? new Date(epochStartTimestamp).toLocaleString() : 'N/A'}</p>
      <p style="margin: 5px 0;"><strong>End Timestamp:</strong> ${epochEndTimestamp ? new Date(epochEndTimestamp).toLocaleString() : 'N/A'}</p>
      <p style="margin: 5px 0;"><strong>Total Eligible Gateways:</strong> ${totalEligibleGatewaysCreated}</p>
      <p style="margin: 5px 0;"><strong>Total Eligible Observer Reward:</strong> ${totalEligibleObserverRewardCreated.toFixed(2)} $ARIO</p>
      <p style="margin: 5px 0;"><strong>Total Eligible Gateway Reward:</strong> ${totalEligibleGatewayRewardCreated.toFixed(2)} $ARIO</p>
      <p style="margin: 5px 0;"><strong>Prescribed Names:</strong></p>
      <ul style="margin: 5px 0; padding-left: 20px;">
        ${prescribedNames.map((name: string) => `<li style="margin: 5px 0; text-decoration: none;"><a href="https://${name}.permagate.io" style="color: #007bff; text-decoration: none;">ar://${name}</a></li>`).join('')}
      </ul>
      <p style="margin: 5px 0;"><strong>Prescribed Observers:</strong></p>
      <ul style="margin: 5px 0; padding-left: 20px;">
        ${Object.entries(prescribedGatewayFqdns)
          .map(
            ([address, fqdn]) =>
              `<li style="margin: 5px 0;">${fqdn} (${address.slice(0, 6)}...${address.slice(-4)})</li>`,
          )
          .join('')}
      </ul>
    </div>
    <br/>
    <a href="https://ao.link/#/message/${event.eventData.id}" 
       style="display: inline-block; background-color: #007bff; color: #ffffff; padding: 10px 15px; border-radius: 5px; text-decoration: none;">
      View on AO
    </a>  
    <br/>
    <br/>
    <a href="https://subscribe.permagate.io/" style="color: #ffffff; text-decoration: none;">subscribe.permagate.io</a>
    <br/>
  </div>
  `;
    case 'epoch-distribution-notice':
      const observationData = event.eventData.data.observations;
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
      const totalObservationsSubmitted =
        Object.keys(observationData.reports || {}).length || 0;
      const totalGatewaysFailed = Object.entries(
        observationData.failureSummaries || {},
      ).reduce((count, [_, reports]) => {
        return (
          count +
          (Array.isArray(reports) &&
          reports.length > totalObservationsSubmitted * 0.5
            ? 1
            : 0)
        );
      }, 0);
      const totalGatewaysPassed = totalEligibleGateways - totalGatewaysFailed;
      const distributedTimestamp = epochData.distributedTimestamp
        ? new Date(epochData.distributedTimestamp).toLocaleString()
        : 'N/A';

      // get the best and worst streaks
      const bestStreaks = await ario.getGateways({
        sortBy: 'stats.passedConsecutiveEpochs',
        sortOrder: 'desc',
        limit: 3,
      });
      const worstStreaks = await ario.getGateways({
        sortBy: 'stats.failedConsecutiveEpochs',
        sortOrder: 'desc',
        limit: 3,
      });

      const newGateways = await ario
        .getGateways({
          sortBy: 'startTimestamp',
          sortOrder: 'desc',
          limit: 10,
        })
        .then((gateways) => {
          // return any gateway that started after the epoch distributed
          return gateways.items.filter((gateway) => {
            return gateway.startTimestamp > epochData.distributedTimestamp;
          });
        });

      const newGatewaysFqdns = newGateways.map(
        (gateway) => gateway.settings.fqdn,
      );

      return `
  <div style="padding: 10px; text-align: center; font-family: Arial, sans-serif; color: #333;">

    <div style="text-align: left; padding: 10px; background: #f8f9fa; border-radius: 5px; margin-bottom: 15px;">
      <h2 style="margin-top: 0;">🔭 Network Performance</h2>
      <ul style="margin: 5px 0; padding-left: 20px;">
        <li style="margin: 5px 0;"><strong># Observations Submitted:</strong> ${totalObservationsSubmitted}/50 (${((totalObservationsSubmitted / 50) * 100).toFixed(2)}%)</li>
        <li style="margin: 5px 0;"><strong># Gateways Eligible:</strong> ${totalEligibleGateways}</li>
        <li style="margin: 5px 0;"><strong># Gateways Failed:</strong> ${totalGatewaysFailed} (${((totalGatewaysFailed / totalEligibleGateways) * 100).toFixed(2)}%)</li>
        <li style="margin: 5px 0;"><strong># Gateways Passed:</strong> ${totalGatewaysPassed} (${((totalGatewaysPassed / totalEligibleGateways) * 100).toFixed(2)}%)</li>
      </ul>
      <br/>
      <h2 style="margin-top: 0;">💰 Rewards</h2>
      <ul style="margin: 5px 0; padding-left: 20px;">
        <li style="margin: 5px 0;"><strong>Eligible Observer Reward:</strong> ${totalEligibleObserverReward.toFixed(2)} $ARIO</li>
        <li style="margin: 5px 0;"><strong>Eligible Gateway Reward:</strong> ${totalEligibleGatewayReward.toFixed(2)} $ARIO</li>
        <li style="margin: 5px 0;"><strong>Total Eligible Rewards:</strong> ${totalEligibleRewards.toFixed(2)} $ARIO</li>
        <li style="margin: 5px 0;"><strong>Total Distributed Rewards:</strong> ${totalDistributedRewards.toFixed(2)} $ARIO (${((totalDistributedRewards / totalEligibleRewards) * 100).toFixed(2)}%)</li>
        <li style="margin: 5px 0;"><strong>Distribution Timestamp:</strong> ${new Date(distributedTimestamp).toLocaleString()}</li>
      </ul>
      <br/>
      <h2 style="margin-top: 0;">📈 Best Performers</h2>
      <ul style="margin: 5px 0; padding-left: 20px;">
        ${bestStreaks.items.map((gateway) => `<li style="margin: 5px 0;">${gateway.settings.fqdn} +${gateway.stats.passedConsecutiveEpochs} epochs</li>`).join('')}
      </ul>
      <br/>
      <h2 style="margin-top: 0;">📉 Worst Performers</h2>
      <ul style="margin: 5px 0; padding-left: 20px;">
        ${worstStreaks.items.map((gateway) => `<li style="margin: 5px 0;">${gateway.settings.fqdn} -${gateway.stats.failedConsecutiveEpochs} epochs</li>`).join('')}
      </ul>
      <br/>
      <h2 style="margin-top: 0;">👋 New Gateways</h2>
      <ul style="margin: 5px 0; padding-left: 20px;">
        ${newGatewaysFqdns.map((fqdn) => `<li style="margin: 5px 0;">${fqdn}</li>`).join('')}
      </ul>
    </div>
    <br/>

    <a href="https://ao.link/#/message/${event.eventData.id}" 
       style="display: inline-block; background-color: #007bff; color: #ffffff; padding: 10px 15px; border-radius: 5px; text-decoration: none;">
      View on AO
    </a>
    <br/>
    <br/>
    <a href="https://subscribe.permagate.io/" style="color: #ffffff; text-decoration: none;">subscribe.permagate.io</a>
    <br/>
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
    <br/>
    <a href="https://subscribe.permagate.io/" style="color: #ffffff; text-decoration: none;">subscribe.permagate.io</a>
    <br/>
  </div>
`;
  }
};
