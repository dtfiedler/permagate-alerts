import { EmailProvider } from './email/mailgun.js';
import { GQLEvent, NewEvent, RawEvent } from './db/schema.js';
import { SqliteDatabase } from './db/sqlite.js';
import * as winston from 'winston';
import { logger } from './logger.js';
import mjml2html from 'mjml';
import { minify } from 'html-minifier-terser';
import { ario } from './lib/ao.js';
import * as config from './config.js';

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
    const { tags, data, block, recipient } = event;
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
        target: recipient || target || '',
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
    const subscribers = await this.db.findSubscribersByEvent({
      processId: event.processId,
      event: event.eventType,
      target: event.eventData.target,
    });

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

    if (config.disableEmails) {
      this.logger.info(
        'Skipping email as emails are disabled. Message will be marked as processed.',
        {
          eventId: event.eventData.id,
          eventType: event.eventType,
        },
      );
      this.db.markEventAsProcessed(+event.nonce);
      return;
    }

    const mjmlTemplate = await getEmailBodyForEvent(event);
    // Convert MJML to HTML
    const htmlOutput = mjml2html(mjmlTemplate, {
      keepComments: false,
      beautify: false,
      minify: false, // we'll minify ourselves in the next step
    });

    // Minify the HTML to reduce size
    const html = await minify(htmlOutput.html, {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: true,
      minifyURLs: true,
      removeEmptyElements: true,
    });

    const subject = getEmailSubjectForEvent(event);

    if (subscribers.length > 0) {
      // send email, but don't await
      this.notifier
        ?.sendEventEmail({
          to: subscribers.map((subscriber) => subscriber.email),
          subject,
          html,
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
    case 'update-gateway-settings-notice':
      return `🔄 ${event.eventData.target.slice(0, 6)}...${event.eventData.target.slice(-4)} (${event.eventData.data.settings.fqdn}) has updated their gateway!`;
    case 'credit-notice':
      return `💸 ${event.eventData.target.slice(0, 6)}...${event.eventData.target.slice(-4)} received ${parseInt(event.eventData.tags.find((tag) => tag.name === 'Quantity')?.value || '0') / 1_000_000} $ARIO from ${event.eventData.tags.find((tag) => tag.name === 'Sender')?.value.slice(0, 6) + '...' + event.eventData.tags.find((tag) => tag.name === 'Sender')?.value.slice(-4)}`;
    case 'debit-notice':
      const debitAmount =
        parseInt(
          event.eventData.tags.find((tag) => tag.name === 'Quantity')?.value ||
            '0',
        ) / 1_000_000;
      const debitRecipient =
        event.eventData.tags
          .find((tag) => tag.name === 'Recipient')
          ?.value.slice(0, 6) +
        '...' +
        event.eventData.tags
          .find((tag) => tag.name === 'Recipient')
          ?.value.slice(-4);
      const sender =
        event.eventData.target.slice(0, 6) +
        '...' +
        event.eventData.target.slice(-4);
      return `💸 ${sender} sent ${debitAmount} $ARIO to ${debitRecipient}`;
    default:
      return `🚨 New ${event.eventType.replace(/-/g, ' ').toLowerCase()}!`;
  }
};

const getEmailBodyForEvent = async (event: NewEvent) => {
  switch (event.eventType.toLowerCase()) {
    case 'credit-notice':
      const amount =
        parseInt(
          event.eventData.tags.find((tag) => tag.name === 'Quantity')?.value ||
            '0',
        ) / 1_000_000;
      const creditNoticeRecipient =
        event.eventData.target.slice(0, 6) +
        '...' +
        event.eventData.target.slice(-4);
      const creditNoticeSender =
        event.eventData.tags
          .find((tag) => tag.name === 'Sender')
          ?.value.slice(0, 6) +
        '...' +
        event.eventData.tags
          .find((tag) => tag.name === 'Sender')
          ?.value.slice(-4);
      return `
<mjml>
  <mj-head>
    <mj-title>Debit Notice</mj-title>
    <mj-font name="Inter" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" />
    <mj-attributes>
      <mj-all font-family="Inter, sans-serif" />
      <mj-text font-size="14px" color="#333" line-height="1.5" />
    </mj-attributes>
    <mj-style inline="inline">
      .info-table th {
        background-color: #fafafa !important;
        font-weight: 600 !important;
      }
      .info-table th,
      .info-table td {
        border-bottom: 1px solid #eaeaea !important;
        text-align: left !important;
        padding: 6px !important;
      }
    </mj-style> 
  </mj-head>
  <mj-body background-color="#0f0f0f">
    <!-- Top Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>
    
    <!-- Header Section -->
    <mj-section background-color="#1c1c1c" padding="30px 20px">
      <mj-column>
        <mj-text
          color="#ffffff"
          font-size="24px"
          font-weight="600"
          align="center"
          padding-bottom="0"
        >
          Credit Notice
        </mj-text>
      </mj-column>
    </mj-section>
    
    <!-- White Card Wrapper -->
    <mj-wrapper
      background-color="#ffffff"
      border-radius="8px"
      padding="20px 0"
      css-class="card-container"
    >
      <!-- Credit Details Section -->
      <mj-section padding="0">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            Transaction Details
          </mj-text>
          <mj-table css-class="info-table" padding="0 20px 20px" width="100%">
            <tr>
              <th width="40%">Transaction ID</th>
              <td width="60%"><a href="https://ao.link/#/message/${event.eventData.id}" style="color: #007bff; text-decoration: underline;">${event.eventData.id}</a></td>
            </tr>
            <tr>
              <th width="40%">Sender</th>
              <td width="60%">${creditNoticeSender}</td>
            </tr>
            <tr>
              <th width="40%">Recipient</th>
              <td width="60%">${creditNoticeRecipient}</td>
            </tr> 
            <tr>
              <th width="40%">Amount</th>
              <td width="60%">${amount} $ARIO</td>
            </tr>
          </mj-table>
        </mj-column>
      </mj-section>
    </mj-wrapper>
    
    <!-- Footer Section -->
    <mj-section background-color="#1c1c1c" padding="20px">
      <mj-column>
        <mj-button
          background-color="#007bff"
          color="#ffffff"
          border-radius="5px"
          font-weight="600"
          href="https://ao.link/#/message/${event.eventData.id}"
        >
          View on AO
        </mj-button>
        <mj-text
          font-size="12px"
          color="#cccccc"
          align="center"
        >

          <br/>
          You are receiving this email because you subscribed to subscribe.permagate.io
        </mj-text>
      </mj-column>
    </mj-section>
    
    <!-- Bottom Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>
  </mj-body>
</mjml>
  `;
    case 'debit-notice':
      const debitAmount =
        parseInt(
          event.eventData.tags.find((tag) => tag.name === 'Quantity')?.value ||
            '0',
        ) / 1_000_000;
      const debitNoticeSender =
        event.eventData.target.slice(0, 6) +
        '...' +
        event.eventData.target.slice(-4);
      const debitNoticeRecipient =
        event.eventData.tags
          .find((tag) => tag.name === 'Recipient')
          ?.value.slice(0, 6) +
        '...' +
        event.eventData.tags
          .find((tag) => tag.name === 'Recipient')
          ?.value.slice(-4);

      return `
<mjml>
  <mj-head>
    <mj-title>Debit Notice</mj-title>
    <mj-font name="Inter" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" />
    <mj-attributes>
      <mj-all font-family="Inter, sans-serif" />
      <mj-text font-size="14px" color="#333" line-height="1.5" />
    </mj-attributes>
    <mj-style inline="inline">
      .info-table th {
        background-color: #fafafa !important;
        font-weight: 600 !important;
      }
      .info-table th,
      .info-table td {
        border-bottom: 1px solid #eaeaea !important;
        text-align: left !important;
        padding: 6px !important;
      }
    </mj-style>
  </mj-head>

  <mj-body background-color="#0f0f0f">
    <!-- Top Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>

    <!-- Header Section -->
    <mj-section background-color="#1c1c1c" padding="30px 20px">
      <mj-column>
        <mj-text
          color="#ffffff"
          font-size="24px"
          font-weight="600"
          align="center"
          padding-bottom="0"
        >
          Debit Notice
        </mj-text>
      </mj-column>
    </mj-section>

    <!-- White Card Wrapper -->
    <mj-wrapper
      background-color="#ffffff"
      border-radius="8px"
      padding="20px 0"
      css-class="card-container"
    >
      <mj-section padding="0">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            Transaction Details
          </mj-text>
          <mj-table css-class="info-table" padding="0 20px 20px" width="100%">
            <tr>
              <th width="40%">Transaction ID</th>
              <td width="60%"><a href="https://ao.link/#/message/${event.eventData.id}" style="color: #007bff; text-decoration: underline;">${event.eventData.id}</a></td>
            </tr>
            <tr>
              <th width="40%">Sender</th>
              <td width="60%">${debitNoticeSender}</td>
            </tr>
            <tr>
              <th width="40%">Recipient</th>
              <td width="60%">${debitNoticeRecipient}</td>
            </tr>
            <tr>
              <th width="40%">Amount</th>
              <td width="60%">${debitAmount} $ARIO</td>
            </tr>
          </mj-table>
        </mj-column>
      </mj-section>
    </mj-wrapper>
    
    <!-- Footer Section -->
    <mj-section background-color="#1c1c1c" padding="20px">
      <mj-column>
        <mj-button
          background-color="#007bff"
          color="#ffffff"
          border-radius="5px"
          font-weight="600"
          href="https://ao.link/#/message/${event.eventData.id}"
        >
          View on AO
        </mj-button>
        <mj-text
          font-size="12px"
          color="#cccccc"
          align="center"
        >

          <br/>
          You are receiving this email because you subscribed to subscribe.permagate.io
        </mj-text>
      </mj-column>
    </mj-section>
    
    <!-- Bottom Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>
  </mj-body>
</mjml>
  `;
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
        getLeaseDurationYears(startTimestamp, endTimestamp) || 0;

      return `
<mjml>
  <mj-head>
    <mj-title>Name Purchase Notice</mj-title>
    <mj-font name="Inter" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" />
    <mj-attributes>
      <mj-all font-family="Inter, sans-serif" />
      <mj-text font-size="14px" color="#333" line-height="1.5" />
    </mj-attributes>
    <mj-style inline="inline">
      .info-table th {
        background-color: #fafafa !important;
        font-weight: 600 !important;
      }
      .info-table th,
      .info-table td {
        border-bottom: 1px solid #eaeaea !important;
        text-align: left !important;
        padding: 6px !important;
      }
      ul {
        margin: 5px 0 !important;
        padding-left: 20px !important;
      }
      li {
        margin: 5px 0 !important;
      }
    </mj-style>
  </mj-head>

  <mj-body background-color="#0f0f0f">
    <!-- Top Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>
    
    <!-- Header Section -->
    <mj-section background-color="#1c1c1c" padding="30px 20px">
      <mj-column>
        <mj-text
          color="#ffffff"
          font-size="24px"
          font-weight="600"
          align="center"
          padding-bottom="0"
        >
          ${name} has been ${type === 'permabuy' ? 'permabought' : 'leased'}!
        </mj-text>
      </mj-column>
    </mj-section>

    <!-- White Card Wrapper -->
    <mj-wrapper
      background-color="#ffffff"
      border-radius="8px"
      padding="20px 0"
      css-class="card-container"
    >
      <!-- Name Details Section -->
      <mj-section padding="0">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            Details
          </mj-text>
          <mj-table css-class="info-table" padding="0 20px 20px" width="100%">
            <tr>
              <th width="40%">Name</th>
              <td width="60%"><a href="https://${name}.permagate.io" style="color: #007bff; text-decoration: none;">${name}</a></td>
            </tr>
            <tr>
              <th width="40%">Purchase Price</th>
              <td width="60%">${(event.eventData.data.purchasePrice / 1_000_000).toFixed(2).toLocaleString()} $ARIO</td>
            </tr>
            <tr>
              <th width="40%">Owner</th>
              <td width="60%">
                <a href="https://ao.link/#/entity/${event.eventData.target}" style="color: #007bff; text-decoration: none;">
                  ${event.eventData.target.slice(0, 6)}...${event.eventData.target.slice(-4)}
                </a>
              </td>
            </tr>
            <tr>
              <th width="40%">Type</th>
              <td width="60%">${event.eventData.data.type}</td>
            </tr>
            <tr>
              <th width="40%">Lease Duration</th>
              <td width="60%">${leaseDurationYears ? `${leaseDurationYears} years` : 'Permanent'}</td>
            </tr>
            <tr>
              <th width="40%">Process ID</th>
              <td width="60%">
                <a href="https://ao.link/#/entity/${event.processId}" style="color: #007bff; text-decoration: none;">
                  ${event.processId.slice(0, 6)}...${event.processId.slice(-4)}
                </a>
              </td>
            </tr>
          </mj-table>
        </mj-column>
      </mj-section>

      <!-- View on AO Button -->
      <mj-section padding="10px 0 20px">
        <mj-column>
          <mj-button
            background-color="#007bff"
            color="#ffffff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <!--[if mso | IE]>
        </td>
        </tr>
        </table>
      <![endif]-->
    </mj-wrapper>

    <!-- Footer Section -->
    <mj-section background-color="#1c1c1c" padding="20px">
      <mj-column>
        <mj-text
          font-size="12px"
          color="#cccccc"
          align="center"
        >

          <br/>
          You are receiving this email because you subscribed to subscribe.permagate.io
        </mj-text>
      </mj-column>
    </mj-section>
    
    <!-- Bottom Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>
  </mj-body>
</mjml>
  `;
    case 'join-network-notice':
      return `
<mjml>
  <mj-head>
    <mj-title>${event.eventData.data.settings.fqdn} has joined the network!</mj-title>
    <mj-font name="Inter" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" />
    <mj-attributes>
      <mj-all font-family="Inter, sans-serif" />
      <mj-text font-size="14px" color="#333" line-height="1.5" />
    </mj-attributes>
    <mj-style inline="inline">
      .info-table th {
        background-color: #fafafa !important;
        font-weight: 600 !important;
      }
      .info-table th,
      .info-table td {
        border-bottom: 1px solid #eaeaea !important;
        text-align: left !important;
        padding: 6px !important;
      }
      ul {
        margin: 5px 0 !important;
        padding-left: 20px !important;
      }
      li {
        margin: 5px 0 !important;
      }
    </mj-style>
  </mj-head>

  <mj-body background-color="#0f0f0f">
    <!-- Top Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>
    
    <!-- Header Section -->
    <mj-section background-color="#1c1c1c" padding="30px 20px">
      <mj-column>
        <mj-text
          color="#ffffff"
          font-size="24px"
          font-weight="600"
          align="center"
          padding-bottom="0"
        >
          ${event.eventData.data.settings.fqdn} has joined the network!
        </mj-text>
      </mj-column>
    </mj-section>

    <!-- White Card Wrapper -->
    <mj-wrapper
      background-color="#ffffff"
      border-radius="8px"
      padding="20px 0"
      css-class="card-container"
    >
      <!-- Gateway Info Section -->
      <mj-section padding="0">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            Details
          </mj-text>
          <mj-table css-class="info-table" padding="0 20px 20px" width="100%">
            <tr>
              <th width="40%">FQDN</th>
              <td width="60%">${event.eventData.data.settings.fqdn}</td>
            </tr>
            <tr>
              <th width="40%">Operator Stake</th>
              <td width="60%">${event.eventData.data.operatorStake ? (event.eventData.data.operatorStake / 1_000_000).toFixed(2).toLocaleString() + ' $ARIO' : 'N/A'}</td>
            </tr>
            <tr>
              <th width="40%">Allows Delegated Staking</th>
              <td width="60%">${event.eventData.data.settings.allowDelegatedStaking ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th width="40%">Minimum Delegated Stake</th>
              <td width="60%">${event.eventData.data.settings.allowDelegatedStaking ? (event.eventData.data.settings.minDelegatedStake / 1_000_000).toFixed(2).toLocaleString() + ' $ARIO' : 'N/A'}</td>
            </tr>
            <tr>
              <th width="40%">Delegate Reward Percentage</th>
              <td width="60%">${event.eventData.data.settings.allowDelegatedStaking ? event.eventData.data.settings.delegateRewardShareRatio.toFixed(2).toLocaleString() + '%' : 'N/A'}</td>
            </tr>
            <tr>
              <th width="40%">Gateway Address</th>
              <td width="60%">
                <a href="https://ao.link/#/entity/${event.eventData.target}" style="color: #007bff; text-decoration: none;">
                  ${event.eventData.target.slice(0, 6)}...${event.eventData.target.slice(-4)}
                </a>
              </td>
            </tr>
            <tr>
              <th width="40%">Observer Address</th>
              <td width="60%">
                <a href="https://ao.link/#/entity/${event.eventData.data.observerAddress}" style="color: #007bff; text-decoration: none;">
                  ${event.eventData.data.observerAddress.slice(0, 6)}...${event.eventData.data.observerAddress.slice(-4)}
                </a>
              </td>
            </tr>
          </mj-table>
        </mj-column>
      </mj-section>

      <!-- View on AO Button -->
      <mj-section padding="10px 0 20px">
        <mj-column>
          <mj-button
            background-color="#007bff"
            color="#ffffff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <!--[if mso | IE]>
        </td>
        </tr>
        </table>
      <![endif]-->
    </mj-wrapper>

    <!-- Footer Section -->
    <mj-section background-color="#1c1c1c" padding="20px">
      <mj-column>
        <mj-text
          font-size="12px"
          color="#cccccc"
          align="center"
        >

          <br/>
          You are receiving this email because you subscribed to subscribe.permagate.io
        </mj-text>
      </mj-column>
    </mj-section>
    
    <!-- Bottom Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>
  </mj-body>
</mjml>
      `;
    case 'leave-network-notice':
      return `
<mjml>
  <mj-head>
    <mj-title>Gateway Left Network</mj-title>
    <mj-font name="Inter" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" />
    <mj-attributes>
      <mj-all font-family="Inter, sans-serif" />
      <mj-text font-size="14px" color="#333" line-height="1.5" />
    </mj-attributes>
    <mj-style inline="inline">
      .info-table th {
        background-color: #fafafa !important;
        font-weight: 600 !important;
      }
      .info-table th,
      .info-table td {
        border-bottom: 1px solid #eaeaea !important;
        text-align: left !important;
        padding: 6px !important;
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#0f0f0f">
    <!-- Top Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>
    
    <!-- Header Section -->
    <mj-section background-color="#1c1c1c" padding="30px 20px">
      <mj-column>
        <mj-text
          color="#ffffff"
          font-size="24px"
          font-weight="600"
          align="center"
          padding-bottom="0"
        >
          ${event.eventData.data.settings.fqdn} has left the network
        </mj-text>
      </mj-column>
    </mj-section>

    <!-- White Card Wrapper -->
    <mj-wrapper
      background-color="#ffffff"
      border-radius="8px"
      padding="20px 0"
      css-class="card-container"
    >
      <!-- Gateway Details Section -->
      <mj-section padding="0">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            Gateway Details
          </mj-text>
          <mj-table css-class="info-table" padding="0 20px 20px">
            <tr>
              <th>Gateway FQDN</th>
              <td>${event.eventData.data.settings.fqdn}</td>
            </tr>
            <tr>
              <th>Gateway Address</th>
              <td>
                <a href="https://ao.link/#/address/${event.eventData.target}" style="color: #007bff; text-decoration: none;">
                  ${event.eventData.target.slice(0, 6)}...${event.eventData.target.slice(-4)}
                </a>
              </td>
            </tr>
            <tr>
              <th># Delegates</th>
              <td>${Object.keys(event.eventData.data.delegates).length}</td>
            </tr>
            <tr>
              <th>Total Vaulted Delegate Stakes</th>
              <td>${
                Object.values(
                  event.eventData.data?.delegates as Record<
                    string,
                    {
                      vaults: Record<
                        string,
                        { startTimestamp: number; balance: number }
                      >;
                    }
                  >,
                )
                  .reduce(
                    (
                      acc: number,
                      delegate: {
                        vaults: Record<
                          string,
                          { startTimestamp: number; balance: number }
                        >;
                      },
                    ) =>
                      acc +
                      Object.values(delegate.vaults).reduce(
                        (acc, vault) => acc + vault.balance / 1_000_000,
                        0,
                      ),
                    0,
                  )
                  .toFixed(2) + ' $ARIO'
              }</td>
            <tr>
              <th>Total Vaulted Operator Stake</th>
              <td>${
                Object.values(
                  event.eventData.data?.vaults as Record<
                    string,
                    { startTimestamp: number; balance: number }
                  >,
                )
                  .reduce(
                    (
                      acc: number,
                      vault: { startTimestamp: number; balance: number },
                    ) => acc + vault.balance / 1_000_000,
                    0,
                  )
                  .toFixed(2)
                  .toLocaleString() + ' $ARIO'
              }</td>
            </tr>
            <tr>
              <th>Stakes returned at</th>
              <td>${new Date(event.eventData.data.endTimestamp).toLocaleString()}</td>
            </tr>
          </mj-table>
        </mj-column>
      </mj-section>

      <!-- View on AO Button -->
      <mj-section padding="10px 0 20px">
        <mj-column>
          <mj-button
            background-color="#007bff"
            color="#ffffff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>
    </mj-wrapper>

    <!-- Footer Section -->
    <mj-section background-color="#1c1c1c" padding="20px">
      <mj-column>
        <mj-text
          font-size="12px"
          color="#cccccc"
          align="center"
        >
          <br/>
          You are receiving this email because you subscribed to subscribe.permagate.io
        </mj-text>
      </mj-column>
    </mj-section>
    
    <!-- Bottom Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>
  </mj-body>
</mjml>
      `;
    case 'update-gateway-settings-notice':
      return `
<mjml>
  <mj-head>
    <mj-title>Gateway Settings Update</mj-title>
    <mj-font name="Inter" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" />
    <mj-attributes>
      <mj-all font-family="Inter, sans-serif" />
      <mj-text font-size="14px" color="#333" line-height="1.5" />
    </mj-attributes>
    <mj-style inline="inline">
      .info-table th {
        background-color: #fafafa !important;
        font-weight: 600 !important;
      }
      .info-table th,
      .info-table td {
        border-bottom: 1px solid #eaeaea !important;
        text-align: left !important;
        padding: 6px !important;
      }
    </mj-style> 
  </mj-head>
  <mj-body background-color="#0f0f0f">
    <!-- Header Section -->
    <mj-section background-color="#1c1c1c" padding="20px">
      <mj-column>
        <mj-text
          color="#ffffff"
          font-size="24px"
          font-weight="600"
          align="center"
          padding-bottom="0"
        >
          ${event.eventData.target.slice(0, 6)}...${event.eventData.target.slice(-4)} has updated their gateway (${event.eventData.data.settings.fqdn})
        </mj-text>
      </mj-column>
    </mj-section>
    
    <!-- White Card Wrapper -->
    <mj-wrapper
      background-color="#ffffff"
      border-radius="8px"
      padding="20px 0"
      css-class="card-container"
    >
      <!-- Gateway Details Section -->
      <mj-section padding="0">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            Gateway Details
          </mj-text>
          <mj-table css-class="info-table" padding="0 20px 20px" width="100%">
            <tr>
              <th width="40%">FQDN</th>
              <td width="60%">${event.eventData.data.settings.fqdn}</td>
            </tr>
            <tr>
              <th width="40%">Observer Address</th>
              <td width="60%">${event.eventData.data.observerAddress.slice(0, 6)}...${event.eventData.data.observerAddress.slice(-4)}</td>
            </tr>
            <tr>
              <th width="40%">Operator Stake</th>
              <td width="60%">${event.eventData.data.operatorStake ? (event.eventData.data.operatorStake / 1_000_000).toFixed(2).toLocaleString() + ' $ARIO' : 'N/A'}</td>
            </tr>
            <tr>
              <th width="40%">Auto Stake Enabled</th>
              <td width="60%">${event.eventData.data.settings.autoStake ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th width="40%">Allows Delegated Staking</th>
              <td width="60%">${event.eventData.data.settings.allowDelegatedStaking ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th width="40%">Minimum Delegated Stake</th>
              <td width="60%">${event.eventData.data.settings.minDelegatedStake ? (event.eventData.data.settings.minDelegatedStake / 1_000_000).toFixed(2).toLocaleString() + ' $ARIO' : 'N/A'}</td>
            </tr>
            <tr>
              <th width="40%">Delegate Reward Percentage</th>
              <td width="60%">${event.eventData.data.settings.delegateRewardShareRatio.toFixed(2).toLocaleString() + '%'}</td>
            </tr>
          </mj-table>
        </mj-column>
      </mj-section>
    </mj-wrapper>
    
    <!-- Footer Section -->
    <mj-section background-color="#1c1c1c" padding="20px">
      <mj-column>
        <mj-button
          background-color="#007bff"
          color="#ffffff"
          border-radius="5px"
          font-weight="600"
          href="https://ao.link/#/message/${event.eventData.id}"
        >
          View on AO
        </mj-button>
        <mj-text
          font-size="12px"
          color="#cccccc"
          align="center"
        >
          <br/>
          You are receiving this email because you subscribed to subscribe.permagate.io
        </mj-text>
      </mj-column>
    </mj-section>
    
    <!-- Bottom Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>
  </mj-body>
</mjml>
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

      const newGateways = await ario
        .getGateways({
          sortBy: 'startTimestamp',
          sortOrder: 'desc',
          limit: 10,
        })
        .then((gateways) => {
          // return any gateway that started after the epoch distributed
          return gateways.items.filter((gateway) => {
            return (
              gateway.startTimestamp < epochStartTimestamp &&
              gateway.startTimestamp >=
                epochStartTimestamp - 24 * 60 * 60 * 1000
            );
          });
        })
        .catch((error: any) => {
          logger.error('Error getting new gateways', {
            eventId: event.eventData.id,
            eventType: event.eventType,
            message: error.message,
            stack: error.stack,
          });
          return [];
        });
      const newGatewaysFqdns = newGateways.map(
        (gateway) => gateway.settings.fqdn,
      );

      return `
<mjml>
  <mj-head>
    <mj-title>Epoch ${epochIndex} Created</mj-title>

    <!-- Load the Inter font from Google Fonts -->
    <mj-font
      name="Inter"
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"
    />

    <mj-attributes>
      <!-- Set the default font for all elements to Inter -->
      <mj-all font-family="Inter, sans-serif" />
      <mj-text font-size="14px" color="#333" line-height="1.5" />
    </mj-attributes>

    <mj-style inline="inline">
      /* Table styling inside MJML */
      .info-table th {
        background-color: #fafafa !important;
        font-weight: 600 !important; /* Slightly bolder for column headers */
      }
      .info-table th,
      .info-table td {
        border-bottom: 1px solid #eaeaea !important;
        text-align: left !important;
        padding: 6px !important;
      }

      /* Custom UL styling */
      ul {
        margin: 0 !important;
        padding-left: 20px !important;
      }
      li {
        margin-bottom: 5px !important;
      }
    </mj-style>
  </mj-head>

  <!-- Body: Dark background, similar to ar.io's vibe -->
  <mj-body background-color="#0f0f0f">
    <!-- Top Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>

    <!-- Header Section (Dark) -->
    <mj-section background-color="#1c1c1c" padding="30px 20px">
      <mj-column>
        <mj-text
          color="#ffffff"
          font-size="24px"
          font-weight="600"
          align="center"
          padding-bottom="0"
        >
          Epoch ${epochIndex} Has Been Created!
        </mj-text>
      </mj-column>
    </mj-section>

    <!-- White Card Wrapper with subtle shadow/rounding -->
    <mj-wrapper
      background-color="#ffffff"
      border-radius="8px"
      padding="20px 0"
      css-class="card-container"
    >
      <!--[if mso | IE]>
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600"
          style="box-shadow: 0 2px 5px rgba(0,0,0,0.2); border-radius: 8px;">
          <tr>
          <td>
      <![endif]-->

      <!-- Epoch Details -->
      <mj-section padding="0">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            Epoch Details
          </mj-text>
          <mj-table css-class="info-table" padding="0 20px 20px">
            <tr>
              <th>Epoch Index</th>
              <td>${epochIndex}</td>
            </tr>
            <tr>
              <th>Start Timestamp</th>
              <td>${epochStartTimestamp ? new Date(epochStartTimestamp).toLocaleString() : 'N/A'}</td>
            </tr>
            <tr>
              <th>End Timestamp</th>
              <td>${epochEndTimestamp ? new Date(epochEndTimestamp).toLocaleString() : 'N/A'}</td>
            </tr>
            <tr>
              <th># Eligible Gateways</th>
              <td>${totalEligibleGatewaysCreated}</td>
            </tr>
            <tr>
              <th>Observer Reward</th>
              <td>${totalEligibleObserverRewardCreated.toFixed(2).toLocaleString()} $ARIO</td>
            </tr>
            <tr>
              <th>Gateway Reward</th>
              <td>${totalEligibleGatewayRewardCreated.toFixed(2).toLocaleString()} $ARIO</td>
            </tr>
          </mj-table>
        </mj-column>
      </mj-section>

      ${
        newGatewaysFqdns && newGatewaysFqdns.length > 0
          ? `
      <!-- New Gateways Section -->
      <mj-section padding="0 0 20px">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            New Gateways
          </mj-text>
          <mj-text padding="0 20px">
            <ul>
              ${newGatewaysFqdns.map((fqdn) => `<li>${fqdn}</li>`).join('')}
            </ul>
          </mj-text>
        </mj-column>
      </mj-section>
      `
          : ''
      }

      <!-- Prescribed Names Section -->
      <mj-section padding="0 0 20px">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            Prescribed Names
          </mj-text>
          <mj-text padding="0 20px">
            <ul>
              ${prescribedNames
                .map(
                  (name: string) =>
                    `<li><a href="https://${name}.permagate.io" style="color: #007bff; text-decoration: none;">ar://${name}</a></li>`,
                )
                .join('')}
            </ul>
          </mj-text>
        </mj-column>
      </mj-section>

      <!-- Prescribed Observers Section -->
      <mj-section padding="0">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            Prescribed Observers
          </mj-text>
        </mj-column>
      </mj-section>

      <mj-section padding="0 0 20px">
        <!-- Split observers into columns -->
        <mj-column width="33%" mobileWidth="100%">
          <mj-text color="#333333" padding="0 20px">
            <ul>
              ${Object.entries(prescribedGatewayFqdns)
                .slice(
                  0,
                  Math.ceil(Object.keys(prescribedGatewayFqdns).length / 3),
                )
                .map(
                  ([address, fqdn]) =>
                    `<li>${fqdn} (${address.slice(0, 6)}...${address.slice(-4)})</li>`,
                )
                .join('')}
            </ul>
          </mj-text>
        </mj-column>

        <!-- Column 2 -->
        <mj-column width="33%" mobileWidth="100%">
          <mj-text color="#333333" padding="0 20px">
            <ul>
              ${Object.entries(prescribedGatewayFqdns)
                .slice(
                  Math.ceil(Object.keys(prescribedGatewayFqdns).length / 3),
                  Math.ceil(Object.keys(prescribedGatewayFqdns).length / 3) * 2,
                )
                .map(
                  ([address, fqdn]) =>
                    `<li>${fqdn} (${address.slice(0, 6)}...${address.slice(-4)})</li>`,
                )
                .join('')}
            </ul>
          </mj-text>
        </mj-column>

        <!-- Column 3 -->
        <mj-column width="33%" mobileWidth="100%">
          <mj-text color="#333333" padding="0 20px">
            <ul>
              ${Object.entries(prescribedGatewayFqdns)
                .slice(
                  Math.ceil(Object.keys(prescribedGatewayFqdns).length / 3) * 2,
                )
                .map(
                  ([address, fqdn]) =>
                    `<li>${fqdn} (${address.slice(0, 6)}...${address.slice(-4)})</li>`,
                )
                .join('')}
            </ul>
          </mj-text>
        </mj-column>
      </mj-section>

      <!-- View on AO Button -->
      <mj-section padding="10px 0 20px">
        <mj-column>
          <mj-button
            background-color="#007bff"
            color="#ffffff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <!--[if mso | IE]>
        </td>
        </tr>
        </table>
      <![endif]-->
    </mj-wrapper>

    <!-- Footer Section -->
    <mj-section background-color="#1c1c1c" padding="20px">
      <mj-column>
        <mj-text
          font-size="12px"
          color="#cccccc"
          align="center"
        >

          <br/>
          You are receiving this email because you subscribed to subscribe.permagate.io
        </mj-text>
      </mj-column>
    </mj-section>
    
    <!-- Bottom Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>

  </mj-body>
</mjml>`;

    case 'epoch-distribution-notice':
      const observationData = event.eventData.data.observations;
      const epochData = event.eventData.data.distributions;
      const distributedEpochIndex = event.eventData.data.epochIndex;
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
      const bestStreaks = await ario
        .getGateways({
          sortBy: 'stats.passedConsecutiveEpochs',
          sortOrder: 'desc',
          limit: 3,
        })
        // filter out leaving gateways
        .then((gateways) =>
          gateways.items.filter((gateway) => gateway.status === 'joined'),
        )
        .catch((error: any) => {
          logger.error('Error getting best streaks', {
            eventId: event.eventData.id,
            eventType: event.eventType,
            message: error.message,
            stack: error.stack,
          });
          return { items: [] };
        });
      const worstStreaks = await ario
        .getGateways({
          sortBy: 'stats.failedConsecutiveEpochs',
          sortOrder: 'desc',
          limit: 3,
        })
        // filter out leaving gateways
        .then((gateways) =>
          gateways.items.filter((gateway) => gateway.status === 'joined'),
        )
        .catch((error: any) => {
          logger.error('Error getting worst streaks', {
            eventId: event.eventData.id,
            eventType: event.eventType,
            message: error.message,
            stack: error.stack,
          });
          return { items: [] };
        });
      return `
<mjml>
  <mj-head>
    <mj-title>Epoch ${distributedEpochIndex} Observation Results</mj-title>
    <mj-font name="Inter" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" />
    <mj-attributes>
      <mj-all font-family="Inter, sans-serif" />
      <mj-text font-size="14px" color="#333" line-height="1.5" />
    </mj-attributes>
    <mj-style inline="inline">
      .info-table th {
        background-color: #fafafa !important;
        font-weight: 600 !important;
      }
      .info-table th,
      .info-table td {
        border-bottom: 1px solid #eaeaea !important;
        text-align: left !important;
        padding: 6px !important;
      }
      ul {
        margin: 5px 0 !important;
        padding-left: 20px !important;
      }
      li {
        margin: 5px 0 !important;
      }
    </mj-style>
  </mj-head>

  <mj-body background-color="#0f0f0f">
    <!-- Top Padding -->
    <mj-section padding="20px 0">
    <!-- Header Section -->
    <mj-section background-color="#1c1c1c" padding="30px 20px">
      <mj-column>
        <mj-text
          color="#ffffff"
          font-size="24px"
          font-weight="600"
          align="center"
          padding-bottom="0"
        >
          Epoch ${distributedEpochIndex} Observation Results
        </mj-text>
      </mj-column>
    </mj-section>

    <!-- White Card Wrapper -->
    <mj-wrapper
      background-color="#ffffff"
      border-radius="8px"
      padding="20px 0"
      css-class="card-container"
    >
      <!-- Network Performance Section -->
      <mj-section padding="0">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            🔭 Network Performance
          </mj-text>
          <mj-table css-class="info-table" padding="0 20px 20px" width="100%">
            <tr>
              <th width="40%">Observations Submitted</th>
              <td width="60%">${totalObservationsSubmitted}/50 (${((totalObservationsSubmitted / 50) * 100).toFixed(2)}%)</td>
            </tr>
            <tr>
              <th width="40%">Gateways Eligible</th>
              <td width="60%">${totalEligibleGateways}</td>
            </tr>
            <tr>
              <th width="40%">Gateways Failed</th>
              <td width="60%">${totalGatewaysFailed} (${((totalGatewaysFailed / totalEligibleGateways) * 100).toFixed(2)}%)</td>
            </tr>
            <tr>
              <th width="40%">Gateways Passed</th>
              <td width="60%">${totalGatewaysPassed} (${((totalGatewaysPassed / totalEligibleGateways) * 100).toFixed(2)}%)</td>
            </tr>
          </mj-table>
        </mj-column>
      </mj-section>

      <!-- Rewards Section -->
      <mj-section padding="0">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            💰 Rewards
          </mj-text>
          <mj-table css-class="info-table" padding="0 20px 20px" width="100%">
            <tr>
              <th width="40%">Observer Reward</th>
              <td width="60%">${totalEligibleObserverReward.toFixed(2).toLocaleString()} $ARIO</td>
            </tr>
            <tr>
              <th width="40%">Gateway Reward</th>
              <td width="60%">${totalEligibleGatewayReward.toFixed(2).toLocaleString()} $ARIO</td>
            </tr>
            <tr>
              <th width="40%">Total Eligible Rewards</th>
              <td width="60%">${totalEligibleRewards.toFixed(2).toLocaleString()} $ARIO</td>
            </tr>
            <tr>
              <th width="40%">Total Distributed Rewards</th>
              <td width="60%">${totalDistributedRewards.toFixed(2).toLocaleString()} $ARIO (${((totalDistributedRewards / totalEligibleRewards) * 100).toFixed(2)}%)</td>
            </tr>
            <tr>
              <th width="40%">Distribution Timestamp</th>
              <td width="60%">${distributedTimestamp}</td>
            </tr>
          </mj-table>
        </mj-column>
      </mj-section>

      ${
        bestStreaks.items && bestStreaks.items.length > 0
          ? `
      <!-- Best Performers Section -->
      <mj-section padding="0">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            📈 Best Performers
          </mj-text>
          <mj-table css-class="info-table" padding="0 20px 20px" width="100%">
            ${bestStreaks.items
              .map(
                (gateway) => `
            <tr>
              <th width="40%">${gateway.settings.fqdn}</th>
              <td width="60%">+${gateway.stats.passedConsecutiveEpochs} epochs</td>
            </tr>`,
              )
              .join('')}
          </mj-table>
        </mj-column>
      </mj-section>
      `
          : ''
      }

      ${
        worstStreaks.items && worstStreaks.items.length > 0
          ? `
      <!-- Worst Performers Section -->
      <mj-section padding="0">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            📉 Worst Performers
          </mj-text>
          <mj-table css-class="info-table" padding="0 20px 20px" width="100%">
            ${worstStreaks.items
              .map(
                (gateway) => `
            <tr>
              <th width="40%">${gateway.settings.fqdn}</th>
              <td width="60%">-${gateway.stats.failedConsecutiveEpochs} epochs</td>
            </tr>`,
              )
              .join('')}
          </mj-table>
        </mj-column>
      </mj-section>
      `
          : ''
      }
    </mj-wrapper>

    <!-- Footer Section -->
    <!-- Footer Section -->
    <mj-section background-color="#1c1c1c" padding="20px">
      <mj-column>
        <mj-button
          background-color="#007bff"
          color="#ffffff"
          border-radius="5px"
          font-weight="600"
          href="https://ao.link/#/message/${event.eventData.id}"
        >
          View on AO
        </mj-button>
        <mj-text
          font-size="12px"
          color="#cccccc"
          align="center"
        >

          <br/>
          You are receiving this email because you subscribed to subscribe.permagate.io
        </mj-text>
      </mj-column>
    </mj-section>
    
    <!-- Bottom Padding -->
    <mj-section padding="20px 0">
      <mj-column></mj-column>
    </mj-section>
  </mj-body>
</mjml>
  `;
    default:
      return `
<mjml>
  <mj-head>
    <mj-title>Event Notification</mj-title>
    <mj-font name="Inter" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" />
    <mj-attributes>
      <mj-all font-family="Inter, sans-serif" />
      <mj-text font-size="14px" color="#333" line-height="1.5" />
    </mj-attributes>
    <mj-style inline="inline">
      .info-table th {
        background-color: #fafafa !important;
        font-weight: 600 !important;
      }
      .info-table th,
      .info-table td {
        border-bottom: 1px solid #eaeaea !important;
        text-align: left !important;
        padding: 6px !important;
      }
    </mj-style>
  </mj-head>

  <mj-body background-color="#0f0f0f">
    <!-- Header Section -->
    <mj-section background-color="#1c1c1c" padding="30px 20px">
      <mj-column>
        <mj-text
          color="#ffffff"
          font-size="24px"
          font-weight="600"
          align="center"
          padding-bottom="0"
        >
          Event Details
        </mj-text>
      </mj-column>
    </mj-section>

    <!-- White Card Wrapper -->
    <mj-wrapper
      background-color="#ffffff"
      border-radius="8px"
      padding="20px 0"
      css-class="card-container"
    >
      <!-- Event Data Section -->
      <mj-section padding="0">
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
            padding="0 20px 10px"
          >
            Details
          </mj-text>
          <mj-table css-class="info-table" padding="0 20px 20px" width="100%">
            ${Object.entries(event.eventData.data)
              .filter(
                ([_, value]) => typeof value !== 'object' || value === null,
              )
              .map(
                ([key, value]) => `
            <tr>
              <th width="40%">${key}</th>
              <td width="60%">${value}</td>
            </tr>`,
              )
              .join('')}
          </mj-table>
        </mj-column>
      </mj-section>

      <!-- View on AO Button -->
      <mj-section padding="10px 0 20px">
        <mj-column>
          <mj-button
            background-color="#007bff"
            color="#ffffff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>
    </mj-wrapper>

    <!-- Footer Section -->
    <mj-section background-color="#1c1c1c" padding="20px">
      <mj-column>
        <mj-text
          font-size="12px"
          color="#cccccc"
          align="center"
        >

        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`;
  }
};
