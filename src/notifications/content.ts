import { NewEvent } from '../db/schema.js';
import { EmailNotificationData } from './interface.js';
import mjml2html from 'mjml';
import { minify } from 'html-minifier-terser';
import { Logger } from 'winston';
import Turndown from 'turndown';
import { ario, priceService } from '../system.js';
import { logger } from '../logger.js';
import { toUnicode } from 'punycode';
// @ts-ignore
import turndownPluginGfm from 'turndown-plugin-gfm';

const turndown = new Turndown({
  linkStyle: 'inlined',
  bulletListMarker: '*',
  codeBlockStyle: 'fenced',
  preformattedCode: true,
  emDelimiter: '*',
  strongDelimiter: '**',
  fence: '```',
  headingStyle: 'atx',
  hr: '---',
  br: '\n',
});

/**
 * Generates notification content for all providers based on an event
 * This handles HTML, plaintext, and subject generation
 */
export async function generateNotificationContent(
  event: NewEvent,
  logger: Logger,
): Promise<EmailNotificationData> {
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

  // Generate plain text version by removing HTML tags
  // This is a simple implementation - a more sophisticated version would
  // convert HTML tables and structures to plain text
  const text = turndown.turndown(html.replace(/#outlook\b[\s\S]*\}\s*$/, ''));

  // Get subject line
  const subject = await getEmailSubjectForEvent(event);

  logger.debug('Generated notification content', {
    eventType: event.eventType,
    subject,
    htmlLength: html.length,
    textLength: text.length,
  });

  return {
    event,
    html,
    subject,
    text,
  };
}

export const getEmailSubjectForEvent = async (event: NewEvent) => {
  switch (event.eventType) {
    case 'buy-name-notice':
    case 'buy-record-notice':
      const name = event.eventData.data.name;
      const type = event.eventData.data.type;
      const displayName = formatNameForDisplay(name);
      return `💰 ${displayName} has been ${type === 'permabuy' ? 'permabought' : 'leased'}!`;
    case 'save-observations-notice':
      return `📝 ${event.eventData.target.slice(0, 6)}...${event.eventData.target.slice(-4)} submitted an observation report!`;
    case 'failed-observation-notice':
      const gatewayDetails = await ario.getGateway({
        address: event.eventData.target,
      });
      return `❌ ${event.eventData.from?.slice(0, 6)}...${event.eventData.from?.slice(-4)} marked ${gatewayDetails?.settings.fqdn || event.eventData.target.slice(0, 6)}...${event.eventData.target.slice(-4)} as failed!`;
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

export const getEmailBodyForEvent = async (event: NewEvent) => {
  switch (event.eventType.toLowerCase()) {
    case 'create-vault-notice': {
      const amount = event.eventData.data.balance / 1_000_000;
      const amountUSD = await priceService.getPriceForTokenQuantity({
        token: 'ar-io-network',
        quantity: amount,
      });
      return `
<mjml>
  <mj-head>
    <mj-title>Vaulted Transfer Notice</mj-title>
    <mj-font name="Geist" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap" />
    <mj-attributes>
      <mj-all font-family="Geist, sans-serif" />
      <mj-text font-size="12px" color="#333" line-height="1.5" />
    </mj-attributes>
    <mj-style inline="inline">
      .info-table th {
        background-color: #fafafa !important;
        font-weight: 600 !important;
      }
      .info-table th,
      .info-table td {
        padding: 8px !important;
        border: 1px solid #eee !important;
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#ffffff">
    <mj-section>
      <mj-column>
        <mj-text font-size="20px" font-weight="bold" color="#333">
          Vaulted Transfer Notice
        </mj-text>
        <mj-text>
          A new vaulted transfer has been made in the network.
        </mj-text>
        <mj-table css-class="info-table">
          <tr>
            <th>From</th>
            <td>${event.eventData.from?.slice(0, 6)}...${event.eventData.from?.slice(-4)}</td>
          </tr>
          <tr>
            <th>To</th>
            <td>${event.eventData.target.slice(0, 6)}...${event.eventData.target.slice(-4)}</td>
          </tr>
          <tr>
            <th>Amount</th>
            <td>${amount} $ARIO ($${amountUSD.toFixed(2).toLocaleString()} USD)</td>
          </tr>
          <tr>
            <th>Unlocks at</th>
            <td>${new Date(event.eventData.data.endTimestamp).toLocaleString()}</td>
          </tr>
        </mj-table>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
    }
    case 'save-observations-notice': {
      const prescribedObservers = await ario
        .getPrescribedObservers()
        .catch(() => undefined);
      const observer = Object.values(prescribedObservers || {}).find(
        (observer) => observer.observerAddress === event.eventData?.target,
      );
      const observerGateway = await ario
        .getGateway({
          address: observer?.gatewayAddress || '',
        })
        .catch(() => undefined);

      const failedGateways = Object.entries(
        event.eventData?.data.failureSummaries,
      )
        .map(([gatewayAddress, observersThatFailedGateway]) => {
          // if the gateway has the sender, increment the count
          if (
            (observersThatFailedGateway as string[]).includes(
              event.eventData.target,
            )
          ) {
            return gatewayAddress;
          }
          return undefined;
        })
        .filter(Boolean);
      const reportTxId =
        event.eventData?.data?.reports?.[event.eventData.target];
      return `
<mjml>
  <mj-head>
    <mj-title>Save Observation Notice</mj-title>
    <mj-font name="Geist" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap" />
    <mj-attributes>
      <mj-all font-family="Geist, sans-serif" />
      <mj-text font-size="12px" color="#333" line-height="1.5" />
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
      .shadow-box {
        box-shadow: 0px 0px 8px rgba(0, 0, 0, 0.1);
      }
    </mj-style>
    
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-wrapper padding="30px">
      <mj-section>
        <mj-column>
          <mj-text
            font-size="24px"
            font-weight="600"
            align="center"
          >
            ${observerGateway?.settings?.fqdn || event.eventData.target.slice(0, 6)}...${event.eventData.target.slice(-4)} submitted an observation report!
          </mj-text>
        </mj-column>
      </mj-section>

      <mj-section
        background-color="white"
        border-radius="8px"
        padding="10px"
        css-class="shadow-box"
        width="100%"
      >
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            Details
          </mj-text>
          <mj-table css-class="info-table">
            <tr>
              <th width="40%">Failed Gateways</th>
              <td width="60%">${failedGateways?.length || 0}</td>
            </tr>
            <tr>
              <th width="40%">Report Tx ID</th>
              <td width="60%"><a href="https://permagate.io/${reportTxId}" style="color: #007bff; text-decoration: none;">${reportTxId.slice(0, 6)}...${reportTxId.slice(-4)}</a></td>
            </tr>
          </mj-table>
          <mj-button
            background-color="#007bff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column width="60%">
          <mj-text
            font-size="12px"
            color="#afafaf"
            align="center"
          >
            <br/>
            You are receiving this email because you subscribed to subscribe.permagate.io
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-wrapper>
  </mj-body>
`;
    }
    case 'failed-observation-notice': {
      const observations = await ario.getObservations();
      const failureSummaries =
        observations?.failureSummaries[event.eventData.target] || [];
      const totalObservations = Object.keys(observations?.reports || {}).length;
      const failurePercentage =
        (failureSummaries.length / totalObservations) * 100;
      const status = failurePercentage > 50 ? 'FAILING' : 'PASSING';
      const prescribedObservers = await ario
        .getPrescribedObservers()
        .catch(() => ({}));
      const totalPrescribedObservers = Object.keys(prescribedObservers).length;
      const gatewayDetails = await ario.getGateway({
        address: event.eventData.target,
      });
      const observer = Object.values(prescribedObservers).find(
        (observer) => observer.observerAddress === event.eventData?.from,
      );
      const observerGateway = await ario.getGateway({
        address: observer?.gatewayAddress || '',
      });
      const report = observations?.reports[event.eventData?.from || ''];
      return `
<mjml>
  <mj-head>
    <mj-title>Failed Observation Notice</mj-title>
    <mj-font name="Geist" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap" />
    <mj-attributes>
      <mj-all font-family="Geist, sans-serif" />
      <mj-text font-size="12px" color="#333" line-height="1.5" />
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
      .shadow-box {
        box-shadow: 0px 0px 8px rgba(0, 0, 0, 0.1);
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-wrapper padding="30px">
      <mj-section>
        <mj-column>
          <mj-text
            font-size="24px"
            font-weight="600"
            align="center"
          >
            ${event.eventData.from} marked ${gatewayDetails?.settings.fqdn} as failed!
          </mj-text>
        </mj-column>
      </mj-section>

      <mj-section
        background-color="white"
        border-radius="8px"
        padding="10px"
        css-class="shadow-box"
        width="100%"
      >
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            Details
          </mj-text>
          <mj-table css-class="info-table">
            <tr>
              <th width="40%"># Observations</th>
              <td width="60%">${totalObservations}/${totalPrescribedObservers}</td>
            </tr>
            <tr>
              <th width="40%"># Failures</th>
              <td width="60%">${observations?.failureSummaries[event.eventData.target]?.length} / ${totalObservations}</td>
            </tr>
            <tr>
              <th width="40%">Epoch Status</th>
              <td width="60%" style="color:${status === 'FAILING' ? '#ff0000' : '#006400'};">${status}</td>
            </tr>
            <tr>
              <th width="40%">Observer</th>
              <td width="60%">${event.eventData.from?.slice(0, 6)}...${event.eventData.from?.slice(-4)} (${observerGateway?.settings?.fqdn})</td>
            </tr>
            <tr>
              <th width="40%">Report</th>
              <td width="60%">
                <a href="https://permagate.io/${report}" style="color: #007bff; text-decoration: none;">
                  ${report.slice(0, 6)}...${report.slice(-4)}
                </a>
              </td>
            </tr>
          </mj-table>
          <mj-button
            background-color="#007bff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column width="60%">
          <mj-text
            font-size="12px"
            color="#afafaf"
            align="center"
          >
            <br/>
            You are receiving this email because you subscribed to subscribe.permagate.io
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-wrapper>
  </mj-body>
</mjml>
  `;
    }
    case 'credit-notice': {
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
    <mj-title>Credit Notice</mj-title>
    <mj-font name="Geist" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap" />
    <mj-attributes>
      <mj-all font-family="Geist, sans-serif" />
      <mj-text font-size="12px" color="#333" line-height="1.5" />
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
      .shadow-box {
        box-shadow: 0px 0px 8px rgba(0, 0, 0, 0.1);
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-wrapper padding="30px">
      <mj-section>
        <mj-column>
          <mj-text
            font-size="24px"
            font-weight="600"
            align="center"
          >
            Credit Notice
          </mj-text>
        </mj-column>
      </mj-section>

      <mj-section
        background-color="white"
        border-radius="8px"
        padding="10px"
        css-class="shadow-box"
        width="100%"
      >
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            Transaction Details
          </mj-text>
          <mj-table css-class="info-table">
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
          <mj-button
            background-color="#007bff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column width="60%">
          <mj-text
            font-size="12px"
            color="#afafaf"
            align="center"
          >
            <br/>
            You are receiving this email because you subscribed to subscribe.permagate.io
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-wrapper>
  </mj-body>
</mjml>
  `;
    }
    case 'debit-notice': {
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
    <mj-font name="Geist" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap" />
    <mj-attributes>
      <mj-all font-family="Geist, sans-serif" />
      <mj-text font-size="12px" color="#333" line-height="1.5" />
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
      .shadow-box {
        box-shadow: 0px 0px 8px rgba(0, 0, 0, 0.1);
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-wrapper padding="30px">
      <mj-section>
        <mj-column>
          <mj-text
            font-size="24px"
            font-weight="600"
            align="center"
          >
            Debit Notice
          </mj-text>
        </mj-column>
      </mj-section>

      <mj-section
        background-color="white"
        border-radius="8px"
        padding="10px"
        css-class="shadow-box"
        width="100%"
      >
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            Transaction Details
          </mj-text>
          <mj-table css-class="info-table">
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
          <mj-button
            background-color="#007bff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column width="60%">
          <mj-text
            font-size="12px"
            color="#afafaf"
            align="center"
          >
            <br/>
            You are receiving this email because you subscribed to subscribe.permagate.io
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-wrapper>
  </mj-body>
</mjml>
  `;
    }
    case 'buy-name-notice':
    case 'buy-record-notice': {
      const name = event.eventData.data.name;
      const displayName = formatNameForDisplay(name);
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
      const purchasePrice = event.eventData.data.purchasePrice / 1_000_000;
      const purchasePriceUSD = await priceService.getPriceForTokenQuantity({
        token: 'ar-io-network',
        quantity: purchasePrice,
      });
      const leaseDurationYears =
        getLeaseDurationYears(startTimestamp, endTimestamp) || 0;

      return `
<mjml>
  <mj-head>
    <mj-title>Name Purchase Notice</mj-title>
    <mj-font name="Geist" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap" />
    <mj-attributes>
      <mj-all font-family="Geist, sans-serif" />
      <mj-text font-size="12px" color="#333" line-height="1.5" />
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
      .shadow-box {
        box-shadow: 0px 0px 8px rgba(0, 0, 0, 0.1);
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-wrapper padding="30px">
      <mj-section>
        <mj-column>
          <mj-text
            font-size="24px"
            font-weight="600"
            align="center"
          >
            ${displayName} has been ${type === 'permabuy' ? 'permabought' : 'leased'}!
          </mj-text>
        </mj-column>
      </mj-section>

      <mj-section
        background-color="white"
        border-radius="8px"
        padding="10px"
        css-class="shadow-box"
        width="100%"
      >
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            Details
          </mj-text>
          <mj-table css-class="info-table">
            <tr>
              <th width="40%">Name</th>
              <td width="60%"><a href="https://${name}.permagate.io" style="color: #007bff; text-decoration: none;">${displayName}</a></td>
            </tr>
            <tr>
              <th width="40%">Purchase Price</th>
              <td width="60%">${purchasePrice.toFixed(2).toLocaleString()} $ARIO ($${purchasePriceUSD.toFixed(2).toLocaleString()} USD)</td>
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
          <mj-button
            background-color="#007bff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column width="60%">
          <mj-text
            font-size="12px"
            color="#afafaf"
            align="center"
          >
            <br/>
            You are receiving this email because you subscribed to subscribe.permagate.io
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-wrapper>
  </mj-body>
</mjml>
  `;
    }
    case 'join-network-notice': {
      const operatorStake = event.eventData.data.operatorStake / 1_000_000;
      const operatorStakeUSD = await priceService.getPriceForTokenQuantity({
        token: 'ar-io-network',
        quantity: operatorStake,
      });
      const minDelegatedStake =
        event.eventData.data.settings.minDelegatedStake / 1_000_000;
      const minDelegatedStakeUSD = await priceService.getPriceForTokenQuantity({
        token: 'ar-io-network',
        quantity: minDelegatedStake,
      });
      return `
<mjml>
  <mj-head>
    <mj-title>${event.eventData.data.settings.fqdn} has joined the network!</mj-title>
    <mj-font name="Geist" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap" />
    <mj-attributes>
      <mj-all font-family="Geist, sans-serif" />
      <mj-text font-size="12px" color="#333" line-height="1.5" />
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
      .shadow-box {
        box-shadow: 0px 0px 8px rgba(0, 0, 0, 0.1);
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-wrapper padding="30px">
      <mj-section>
        <mj-column>
          <mj-text
            font-size="24px"
            font-weight="600"
            align="center"
          >
            ${event.eventData.data.settings.fqdn} has joined the network!
          </mj-text>
        </mj-column>
      </mj-section>

      <mj-section
        background-color="white"
        border-radius="8px"
        padding="10px"
        css-class="shadow-box"
        width="100%"
      >
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            Details
          </mj-text>
          <mj-table css-class="info-table">
            <tr>
              <th width="40%">FQDN</th>
              <td width="60%">${event.eventData.data.settings.fqdn}</td>
            </tr>
            <tr>
              <th width="40%">Operator Stake</th>
              <td width="60%">${event.eventData.data.operatorStake ? `${operatorStake.toFixed(2).toLocaleString()} $ARIO ($${operatorStakeUSD.toFixed(2).toLocaleString()} USD)` : 'N/A'}</td>
            </tr>
            <tr>
              <th width="40%">Allows Delegated Staking</th>
              <td width="60%">${event.eventData.data.settings.allowDelegatedStaking ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th width="40%">Minimum Delegated Stake</th>
              <td width="60%">${event.eventData.data.settings.allowDelegatedStaking ? `${minDelegatedStake.toFixed(2).toLocaleString()} $ARIO ($${minDelegatedStakeUSD.toFixed(2).toLocaleString()} USD)` : 'N/A'}</td>
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
          <mj-button
            background-color="#007bff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column width="60%">
          <mj-text
            font-size="12px"
            color="#afafaf"
            align="center"
          >
            <br/>
            You are receiving this email because you subscribed to subscribe.permagate.io
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-wrapper>
  </mj-body>
</mjml>
      `;
    }
    case 'leave-network-notice': {
      const totalVaultedDelegateStakes = Object.values(
        event.eventData.data?.delegates as Record<
          string,
          {
            vaults: Record<string, { startTimestamp: number; balance: number }>;
          }
        >,
      ).reduce(
        (acc, delegate) =>
          acc +
          Object.values(delegate.vaults).reduce(
            (acc, vault) => acc + vault.balance / 1_000_000,
            0,
          ),
        0,
      );
      const totalVaultedDelegateStakesUSD =
        await priceService.getPriceForTokenQuantity({
          token: 'ar-io-network',
          quantity: totalVaultedDelegateStakes,
        });
      const totalVaultedOperatorStake = Object.values(
        event.eventData.data?.vaults as Record<
          string,
          { startTimestamp: number; balance: number }
        >,
      ).reduce((acc, vault) => acc + vault.balance / 1_000_000, 0);
      const totalVaultedOperatorStakeUSD =
        await priceService.getPriceForTokenQuantity({
          token: 'ar-io-network',
          quantity: totalVaultedOperatorStake,
        });
      return `
<mjml>
  <mj-head>
    <mj-title>Gateway Left Network</mj-title>
    <mj-font name="Geist" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap" />
    <mj-attributes>
      <mj-all font-family="Geist, sans-serif" />
      <mj-text font-size="12px" color="#333" line-height="1.5" />
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
      .shadow-box {
        box-shadow: 0px 0px 8px rgba(0, 0, 0, 0.1);
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-wrapper padding="30px">
      <mj-section>
        <mj-column>
          <mj-text
            font-size="24px"
            font-weight="600"
            align="center"
          >
            ${event.eventData.data.settings.fqdn} has left the network
          </mj-text>
        </mj-column>
      </mj-section>

      <mj-section
        background-color="white"
        border-radius="8px"
        padding="10px"
        css-class="shadow-box"
        width="100%"
      >
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            Gateway Details
          </mj-text>
          <mj-table css-class="info-table">
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
              <td>${totalVaultedDelegateStakes.toFixed(2).toLocaleString()} $ARIO ($${totalVaultedDelegateStakesUSD.toFixed(2).toLocaleString()} USD)</td>
            <tr>
              <th>Total Vaulted Operator Stake</th>
              <td>${totalVaultedOperatorStake.toFixed(2).toLocaleString()} $ARIO ($${totalVaultedOperatorStakeUSD.toFixed(2).toLocaleString()} USD)</td>
            </tr>
            <tr>
              <th>Stakes returned at</th>
              <td>${new Date(event.eventData.data.endTimestamp).toLocaleString()}</td>
            </tr>
          </mj-table>
          <mj-button
            background-color="#007bff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column width="60%">
          <mj-text
            font-size="12px"
            color="#afafaf"
            align="center"
          >
            <br/>
            You are receiving this email because you subscribed to subscribe.permagate.io
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-wrapper>
  </mj-body>
</mjml>
      `;
    }
    case 'update-gateway-settings-notice': {
      const operatorStake = event.eventData.data.operatorStake / 1_000_000;
      const operatorStakeUSD = await priceService.getPriceForTokenQuantity({
        token: 'ar-io-network',
        quantity: operatorStake,
      });
      const minDelegatedStake =
        event.eventData.data.settings.minDelegatedStake / 1_000_000;
      const minDelegatedStakeUSD = await priceService.getPriceForTokenQuantity({
        token: 'ar-io-network',
        quantity: minDelegatedStake,
      });
      return `
<mjml>
  <mj-head>
    <mj-title>Gateway Settings Update</mj-title>
    <mj-font name="Geist" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap" />
    <mj-attributes>
      <mj-all font-family="Geist, sans-serif" />
      <mj-text font-size="12px" color="#333" line-height="1.5" />
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
      .shadow-box {
        box-shadow: 0px 0px 8px rgba(0, 0, 0, 0.1);
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-wrapper padding="30px">
      <mj-section>
        <mj-column>
          <mj-text
            font-size="24px"
            font-weight="600"
            align="center"
          >
            ${event.eventData.target.slice(0, 6)}...${event.eventData.target.slice(-4)} has updated their gateway (${event.eventData.data.settings.fqdn})
          </mj-text>
        </mj-column>
      </mj-section>

      <mj-section
        background-color="white"
        border-radius="8px"
        padding="10px"
        css-class="shadow-box"
        width="100%"
      >
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            Gateway Details
          </mj-text>
          <mj-table css-class="info-table">
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
              <td width="60%">${event.eventData.data.operatorStake ? `${operatorStake.toFixed(2).toLocaleString()} $ARIO ($${operatorStakeUSD.toFixed(2).toLocaleString()} USD)` : 'N/A'}</td>
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
              <td width="60%">${event.eventData.data.settings.minDelegatedStake ? `${minDelegatedStake.toFixed(2).toLocaleString()} $ARIO ($${minDelegatedStakeUSD.toFixed(2).toLocaleString()} USD)` : 'N/A'}</td>
            </tr>
            <tr>
              <th width="40%">Delegate Reward Percentage</th>
              <td width="60%">${event.eventData.data.settings.delegateRewardShareRatio.toFixed(2).toLocaleString() + '%'}</td>
            </tr>
          </mj-table>
          <mj-button
            background-color="#007bff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column width="60%">
          <mj-text
            font-size="12px"
            color="#afafaf"
            align="center"
          >
            <br/>
            You are receiving this email because you subscribed to subscribe.permagate.io
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-wrapper>
  </mj-body>
</mjml>
      `;
    }
    case 'epoch-created-notice': {
      const epochIndex = event.eventData.data.epochIndex;
      const epochStartTimestamp = event.eventData.data.startTimestamp;
      const epochEndTimestamp = event.eventData.data.endTimestamp;

      const totalEligibleGatewaysCreated =
        event.eventData.data.distributions.totalEligibleGateways;
      const totalEligibleObserverRewardCreated =
        event.eventData.data.distributions.totalEligibleObserverReward /
        1_000_000;
      const totalEligibleObserverRewardUSD =
        totalEligibleObserverRewardCreated * (await priceService.getPrice());
      const totalEligibleGatewayRewardCreated =
        event.eventData.data.distributions.totalEligibleGatewayReward /
        1_000_000;
      const totalEligibleGatewayRewardUSD =
        totalEligibleGatewayRewardCreated * (await priceService.getPrice());

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
    <mj-font name="Geist" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap" />
    <mj-attributes>
      <mj-all font-family="Geist, sans-serif" />
      <mj-text font-size="12px" color="#333" line-height="1.5" />
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
      .shadow-box {
        box-shadow: 0px 0px 8px rgba(0, 0, 0, 0.1);
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-wrapper padding="30px">
      <mj-section>
        <mj-column>
          <mj-text
            font-size="24px"
            font-weight="600"
            align="center"
          >
            Epoch ${epochIndex} Has Been Created!
          </mj-text>
        </mj-column>
      </mj-section>

      <mj-section
        background-color="white"
        border-radius="8px"
        padding="10px"
        css-class="shadow-box"
        width="100%"
      >
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            Epoch Details
          </mj-text>
          <mj-table css-class="info-table">
            <tr>
              <th width="40%">Epoch Index</th>
              <td width="60%">${epochIndex}</td>
            </tr>
            <tr>
              <th width="40%">Start Timestamp</th>
              <td width="60%">${epochStartTimestamp ? new Date(epochStartTimestamp).toLocaleString() : 'N/A'}</td>
            </tr>
            <tr>
              <th width="40%">End Timestamp</th>
              <td width="60%">${epochEndTimestamp ? new Date(epochEndTimestamp).toLocaleString() : 'N/A'}</td>
            </tr>
            <tr>
              <th width="40%"># Eligible Gateways</th>
              <td width="60%">${totalEligibleGatewaysCreated}</td>
            </tr>
            <tr>
              <th width="40%">Observer Reward</th>
              <td width="60%">${totalEligibleObserverRewardCreated.toFixed(2).toLocaleString()} $ARIO ($${totalEligibleObserverRewardUSD.toFixed(2).toLocaleString()} USD)</td>
            </tr>
            <tr>
              <th width="40%">Gateway Reward</th>
              <td width="60%">${totalEligibleGatewayRewardCreated.toFixed(2).toLocaleString()} $ARIO ($${totalEligibleGatewayRewardUSD.toFixed(2).toLocaleString()} USD)</td>
            </tr>
          </mj-table>
          ${
            newGatewaysFqdns.length > 0
              ? `
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            New Gateways
          </mj-text>
          <mj-text>
            <ul>
              ${newGatewaysFqdns.map((fqdn) => `<li>${fqdn}</li>`).join('')}
            </ul>
          </mj-text>
          `
              : ''
          }
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            Prescribed Names
          </mj-text>
          <mj-text>
            <ul>
              ${prescribedNames
                .map((name: string) => {
                  const displayName = formatNameForDisplay(name);
                  return `<li><a href="https://${name}.permagate.io" style="color: #007bff; text-decoration: none;">ar://${displayName}</a></li>`;
                })
                .join('')}
            </ul>
          </mj-text>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            Prescribed Observers
          </mj-text>
          <mj-text color="#333333">
            <ul>
              ${Object.entries(prescribedGatewayFqdns)
                .map(
                  ([address, fqdn]) =>
                    `<li>${fqdn} (${address.slice(0, 6)}...${address.slice(-4)})</li>`,
                )
                .join('')}
            </ul>
          </mj-text>
          <mj-button
            background-color="#007bff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column width="60%">
          <mj-text
            font-size="12px"
            color="#afafaf"
            align="center"
          >
            <br/>
            You are receiving this email because you subscribed to subscribe.permagate.io
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-wrapper>
  </mj-body>
</mjml>
      `;
    }
    case 'epoch-distribution-notice': {
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
      const totalEligibleObserverRewardUSD =
        await priceService.getPriceForTokenQuantity({
          token: 'ar-io-network',
          quantity: totalEligibleObserverReward,
        });
      const totalEligibleGatewayRewardUSD =
        await priceService.getPriceForTokenQuantity({
          token: 'ar-io-network',
          quantity: totalEligibleGatewayReward,
        });
      const totalEligibleRewardsUSD =
        await priceService.getPriceForTokenQuantity({
          token: 'ar-io-network',
          quantity: totalEligibleRewards,
        });
      const totalDistributedRewardsUSD =
        await priceService.getPriceForTokenQuantity({
          token: 'ar-io-network',
          quantity: totalDistributedRewards,
        });
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
        .then((gateways) => {
          return {
            items: gateways.items.filter(
              (gateway) => gateway.status === 'joined',
            ),
          };
        })
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
          limit: 10,
        })
        // filter out leaving gateways
        .then((gateways) => {
          return {
            items: gateways.items.filter(
              (gateway) => gateway.status === 'joined',
            ),
          };
        })
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
    <mj-font name="Geist" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap" />
    <mj-attributes>
      <mj-all font-family="Geist, sans-serif" />
      <mj-text font-size="12px" color="#333" line-height="1.5" />
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
      .shadow-box {
        box-shadow: 0px 0px 8px rgba(0, 0, 0, 0.1);
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-wrapper padding="30px">
      <mj-section>
        <mj-column>
          <mj-text
            font-size="24px"
            font-weight="600"
            align="center"
          >
            Epoch ${distributedEpochIndex} Observation Results
          </mj-text>
        </mj-column>
      </mj-section>

      <mj-section
        background-color="white"
        border-radius="8px"
        padding="10px"
        css-class="shadow-box"
        width="100%"
      >
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            🔭 Network Performance
          </mj-text>
          <mj-table css-class="info-table">
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

            <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            💰 Rewards
          </mj-text>
          <mj-table css-class="info-table">
            <tr>
              <th width="40%">Observer Reward</th>
              <td width="60%">${totalEligibleObserverReward.toFixed(2).toLocaleString()} $ARIO ($${totalEligibleObserverRewardUSD.toFixed(2).toLocaleString()} USD)</td>
            </tr>
            <tr>
              <th width="40%">Gateway Reward</th>
              <td width="60%">${totalEligibleGatewayReward.toFixed(2).toLocaleString()} $ARIO ($${totalEligibleGatewayRewardUSD.toFixed(2).toLocaleString()} USD)</td>
            </tr>
            <tr>
              <th width="40%">Total Eligible Rewards</th>
              <td width="60%">${totalEligibleRewards.toFixed(2).toLocaleString()} $ARIO ($${totalEligibleRewardsUSD.toFixed(2).toLocaleString()} USD)</td>
            </tr>
            <tr>
              <th width="40%">Total Distributed Rewards</th>
              <td width="60%">${totalDistributedRewards.toFixed(2).toLocaleString()} $ARIO ($${totalDistributedRewardsUSD.toFixed(2).toLocaleString()} USD) (${((totalDistributedRewards / totalEligibleRewards) * 100).toFixed(2)}%)</td>
            </tr>
            <tr>
              <th width="40%">Distribution Timestamp</th>
              <td width="60%">${distributedTimestamp}</td>
            </tr>
          </mj-table>
          ${
            bestStreaks.items.length > 0
              ? `
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            📈 Best Performers
          </mj-text>
          <mj-table css-class="info-table">
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
          `
              : ''
          }
          ${
            worstStreaks.items.length > 0
              ? `
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            📉 Worst Performers
          </mj-text>
          <mj-table css-class="info-table">
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
          `
              : ''
          }
          <mj-button
            background-color="#007bff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column width="60%">
          <mj-text
            font-size="12px"
            color="#afafaf"
            align="center"
          >
            <br/>
            You are receiving this email because you subscribed to subscribe.permagate.io
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-wrapper>
  </mj-body>
</mjml>
  `;
    }
    default: {
      return `
<mjml>
  <mj-head>
    <mj-title>Event Notification</mj-title>
    <mj-font name="Geist" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap" />
    <mj-attributes>
      <mj-all font-family="Geist, sans-serif" />
      <mj-text font-size="12px" color="#333" line-height="1.5" />
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
      .shadow-box {
        box-shadow: 0px 0px 8px rgba(0, 0, 0, 0.1);
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-wrapper padding="30px">
      <mj-section>
        <mj-column>
          <mj-text
            font-size="24px"
            font-weight="600"
            align="center"
          >
            Event Details
          </mj-text>
        </mj-column>
      </mj-section>

      <mj-section
        background-color="white"
        border-radius="8px"
        padding="10px"
        css-class="shadow-box"
        width="100%"
      >
        <mj-column>
          <mj-text
            font-size="18px"
            font-weight="600"
            color="#101010"
          >
            Details
          </mj-text>
          <mj-table css-class="info-table">
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
          <mj-button
            background-color="#007bff"
            border-radius="5px"
            font-weight="600"
            href="https://ao.link/#/message/${event.eventData.id}"
          >
            View on AO
          </mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column width="60%">
          <mj-text
            font-size="12px"
            color="#afafaf"
            align="center"
          >
            <br/>
            You are receiving this email because you subscribed to subscribe.permagate.io
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-wrapper>
  </mj-body>
</mjml>
      `;
    }
  }
};

/**
 * Checks if a string is Punycode encoded
 * @param str String to check
 * @returns Boolean indicating if the string is Punycode
 */
const isPunycode = (str: string): boolean => {
  return str.startsWith('xn--');
};

/**
 * Decodes a Punycode domain name to Unicode
 * @param str Punycode string to decode
 * @returns Unicode representation of the domain
 */
const decodePunycode = (str: string): string => {
  try {
    return toUnicode(str);
  } catch (error) {
    return str;
  }
};

/**
 * Formats a domain name for display, handling Punycode if needed
 * @param name Domain name that might be Punycode
 * @returns Formatted name for display (with both Punycode and decoded versions if applicable)
 */
export const formatNameForDisplay = (name: string): string => {
  if (isPunycode(name)) {
    const decoded = decodePunycode(name);
    return `${decoded} (${name})`;
  }
  return name;
};
