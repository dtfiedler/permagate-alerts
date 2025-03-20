import Arweave from 'arweave';
import { EventProcessor } from './processor.js';
import winston from 'winston';
import { SqliteDatabase } from './db/sqlite.js';
import { ao } from './lib/ao.js';

interface EventPoller {
  fetchAndProcessEvents(): Promise<void>;
}

export class GQLEventPoller implements EventPoller {
  private processId: string;
  private arweave: Arweave;
  private db: SqliteDatabase;
  private processor: EventProcessor;
  private authorities: string[];
  private gqlUrl: string;
  private logger: winston.Logger;
  private fetching = false;
  private skipToCurrentBlock: boolean;
  constructor({
    processId,
    arweave,
    processor,
    authorities,
    gqlUrl,
    logger,
    db,
    skipToCurrentBlock,
  }: {
    db: SqliteDatabase;
    processId: string;
    arweave: Arweave;
    processor: EventProcessor;
    authorities: string[];
    gqlUrl: string;
    logger: winston.Logger;
    skipToCurrentBlock: boolean;
  }) {
    this.logger = logger.child({
      processId,
      gqlUrl,
    });
    this.db = db;
    this.gqlUrl = gqlUrl;
    this.processId = processId;
    this.arweave = arweave;
    this.processor = processor;
    this.authorities = authorities;
    this.skipToCurrentBlock = skipToCurrentBlock;
    this.fetching = false;
  }

  async getLastBlockHeight(): Promise<number> {
    const lastBlockHeight = await this.db
      .getLatestEventByBlockHeight({ processId: this.processId })
      .then((event) => {
        return event?.blockHeight;
      });
    const latestBlockHeight = await this.arweave.blocks.getCurrent();

    // if we're skipping to the current block, set it to false once we've started
    if (this.skipToCurrentBlock) {
      this.skipToCurrentBlock = false;
      return latestBlockHeight.height;
    }

    // return the minimum of the last block height or the latest block height
    return Math.min(
      lastBlockHeight || latestBlockHeight.height,
      latestBlockHeight.height,
    );
  }

  /**
   * Fetches and processes events from the GQL API. Avoids fetching the same events multiple times and ensures that the events are processed in order.
   * @returns void
   */
  async fetchAndProcessEvents(): Promise<void> {
    if (this.fetching) {
      this.logger.info('Already fetching events, skipping...');
      return;
    }
    this.fetching = true;
    let cursor;
    let hasNextPage = true;
    let lastBlockHeight = await this.getLastBlockHeight();

    try {
      while (hasNextPage) {
        // add timeout to prevent infinite loop
        const signal = AbortSignal.timeout(10_000);
        if (signal.aborted) {
          this.logger.error('Timeout fetching events');
          break;
        }
        this.logger.info(
          `Fetching events from block height ${lastBlockHeight}`,
          {
            cursor,
            hasNextPage,
            lastBlockHeight,
            minBlockHeight: lastBlockHeight,
          },
        );
        const query = eventsFromProcessGqlQuery({
          processId: this.processId,
          cursor: cursor,
          authorities: this.authorities,
          minBlockHeight: lastBlockHeight,
        });
        const response = await fetch(this.gqlUrl, {
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
          body: query,
          signal,
        });
        if (!response.ok) {
          this.logger.error(
            `Error fetching events from block height ${lastBlockHeight}`,
            {
              status: response.status,
              statusText: response.statusText,
            },
          );
          break;
        }

        const data = await response.json();

        // parse the nodes to get the id
        if (
          data?.data === undefined ||
          data?.data?.transactions?.edges?.length === 0
        ) {
          this.logger.info(
            `No events found for block height ${lastBlockHeight}`,
            {
              status: response.status,
              statusText: response.statusText,
            },
          );
          break;
        }

        this.logger.info(
          `Found ${data?.data?.transactions?.edges?.length} events`,
          {
            status: response.status,
            statusText: response.statusText,
          },
        );

        // now get all the events
        const events = data?.data?.transactions?.edges || [];
        const sortedEvents = [...events].sort((a: any, b: any) => {
          return a?.node?.tags
            .find(
              (t: { name: string; value: string }) => t.name === 'Reference',
            )
            ?.value.localeCompare(
              b?.node?.tags.find(
                (t: { name: string; value: string }) => t.name === 'Reference',
              )?.value ?? '',
            );
        });
        // sort events by reference
        for (const event of sortedEvents) {
          // fetch the transaction from arweave
          const eventResult = await this.arweave.api.get(event.node.id);
          const gqlEvent = {
            id: event.node.id,
            tags: event.node.tags,
            data: eventResult.data,
            recipient: event.node.recipient,
            block: {
              height: +event.node.block.height,
            },
          };
          // process the raw event, don't await
          this.processor.processGQLEvent(gqlEvent);
        }
        // update the cursor
        lastBlockHeight = Math.max(
          lastBlockHeight,
          events?.[events.length - 1]?.node?.block?.height ?? 0,
        );
        cursor = events?.[events.length - 1]?.cursor;
        hasNextPage = data?.data?.transactions?.pageInfo?.hasNextPage ?? false;
      }
    } catch (error) {
      this.logger.error('Error fetching events', error);
    } finally {
      this.fetching = false;
      this.logger.info(
        `Finished fetching events up to block height ${lastBlockHeight}`,
      );
    }
  }

  async fetchAndProcessTriggers(): Promise<void> {
    const lastBlockHeight = await this.getLastBlockHeight();
    let cursor;
    let hasNextPage = true;
    let fetching = false;
    try {
      while (hasNextPage) {
        if (fetching) {
          this.logger.info('Already fetching triggers, skipping...');
          return;
        }
        fetching = true;
        const query = triggersForProcessGqlQuery({
          processId: this.processId,
          minBlockHeight: lastBlockHeight,
          cursor: cursor,
        });
        this.logger.info('Fetching triggers for block height', {
          cursor,
          hasNextPage,
          lastBlockHeight,
          minBlockHeight: lastBlockHeight,
        });
        const response = await fetch(this.gqlUrl, {
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
          body: query,
        });
        if (!response.ok) {
          this.logger.error('Error fetching triggers', {
            status: response.status,
            statusText: response.statusText,
          });
          break;
        }
        const data = await response.json();
        if (
          data?.data === undefined ||
          data?.data?.transactions?.edges?.length === 0
        ) {
          this.logger.info(
            `No events found for block height ${lastBlockHeight}`,
            {
              status: response.status,
              statusText: response.statusText,
            },
          );
          break;
        }
        const events = data?.data?.transactions?.edges || [];

        this.logger.info(`Found ${events.length} triggers`, {
          status: response.status,
          statusText: response.statusText,
        });

        const sortedEvents = [...events].sort((a: any, b: any) => {
          return a?.node?.tags
            .find(
              (t: { name: string; value: string }) => t.name === 'Reference',
            )
            ?.value.localeCompare(
              b?.node?.tags.find(
                (t: { name: string; value: string }) => t.name === 'Reference',
              )?.value ?? '',
            );
        });

        for (const event of sortedEvents) {
          const messageResult = await ao.result({
            message: event.node.id,
            process: this.processId,
          });
          for (const message of messageResult.Messages) {
            const data = JSON.parse(message.Data);
            const target = message.Target;
            const tags = message.Tags;
            const gqlEvent = {
              id: event.node.id, // TODO: this is not the correct id as it results from the message getting cranked, but use for now
              data: data,
              tags: [...tags, { name: 'From-Process', value: this.processId }],
              recipient: target,
              block: {
                // TODO: this is not the correct block height as it results from the message getting cranked, but use for now
                height: +event.node.block.height,
              },
            };
            this.processor.processGQLEvent(gqlEvent);
          }
        }
        cursor = events?.[events.length - 1]?.cursor;
        hasNextPage = data?.data?.transactions?.pageInfo?.hasNextPage ?? false;
      }
    } catch (error) {
      this.logger.error('Error fetching events', error);
    } finally {
      this.fetching = false;
      this.logger.info(
        `Finished fetching events up to block height ${lastBlockHeight}`,
      );
    }
  }
}

export const eventsFromProcessGqlQuery = ({
  processId,
  cursor,
  authorities,
  minBlockHeight,
}: {
  processId: string;
  cursor: string | undefined;
  authorities: string[];
  minBlockHeight: number;
}): string => {
  const gqlQuery = JSON.stringify({
    query: `
    query {
      transactions(
        tags: [
          { name: "From-Process", values: ["${processId}"] },
          { name: "Data-Protocol", values: ["ao"] },
          { name: "Action", values: [
              "Epoch-Distribution-Notice",
              "Epoch-Created-Notice",
              "Buy-Name-Notice",
              "Join-Network-Notice",
              "Leave-Network-Notice",
              "Update-Gateway-Settings-Notice"
            ]
          }
        ],
        owners: [${authorities.map((a) => `"${a}"`).join(',')}],
        sort: HEIGHT_ASC,
        first: 100,
        block: { min: ${minBlockHeight} }${cursor ? `, after: "${cursor}"` : ''}
      ) {
        edges {
          cursor
          node {
            id
            recipient
            tags {
              name
              value
            }
            block {
              height
            }
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  `,
  });
  return gqlQuery;
};

export const triggersForProcessGqlQuery = ({
  processId,
  minBlockHeight,
  cursor,
}: {
  processId: string;
  minBlockHeight: number;
  cursor: string | undefined;
}): string => {
  const gqlQuery = JSON.stringify({
    query: `
    query {
      transactions(
        tags: [
          { name: "Action", values: [
              "Buy-Name",
              "Tick",
              "Update-Gateway-Settings",
              "Join-Network",
              "Leave-Network"
            ]
          }
        ],
        sort: HEIGHT_ASC,
        first: 100,
        recipients: ["${processId}"],
        block: { min: ${minBlockHeight} }${cursor ? `, after: "${cursor}"` : ''}
      ) {
        edges {
          cursor
          node {
            id
            block {
              height
            }
            tags {
              name
              value
            }
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  `,
  });
  return gqlQuery;
};
