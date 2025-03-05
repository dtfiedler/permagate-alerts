import Arweave from 'arweave';
import fs from 'fs';
import { EventProcessor } from './processor.js';
import winston from 'winston';

interface EventPoller {
  fetchAndProcessEvents(): Promise<void>;
}

export class GQLEventPoller implements EventPoller {
  private processId: string;
  private arweave: Arweave;
  private lastBlockHeightFile: string;
  private processor: EventProcessor;
  private authorities: string[];
  private gqlUrl: string;
  private logger: winston.Logger;
  private fetching = false;
  constructor({
    processId,
    arweave,
    processor,
    authorities,
    gqlUrl,
    logger,
  }: {
    processId: string;
    arweave: Arweave;
    processor: EventProcessor;
    authorities: string[];
    gqlUrl: string;
    logger: winston.Logger;
  }) {
    this.logger = logger.child({
      processId,
      gqlUrl,
    });
    this.gqlUrl = gqlUrl;
    this.processId = processId;
    this.arweave = arweave;
    this.processor = processor;
    this.authorities = authorities;
    this.lastBlockHeightFile = `./data/last-block-height-${processId}.tx`;
    if (!fs.existsSync(this.lastBlockHeightFile)) {
      fs.writeFileSync(this.lastBlockHeightFile, '0');
    }
    this.fetching = false;
  }

  async getLastBlockHeight(): Promise<number> {
    const lastBlockHeight = parseInt(
      fs.readFileSync(this.lastBlockHeightFile, 'utf8').trim(),
    );
    const latestBlockHeight = await this.arweave.blocks.getCurrent();
    if (isNaN(lastBlockHeight)) {
      return latestBlockHeight.height;
    }

    return Math.min(lastBlockHeight, latestBlockHeight.height);
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
        });
        if (!response.ok) {
          this.logger.error(
            `Error fetching events from block height ${lastBlockHeight}`,
            response,
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
          };
          // process the raw event, don't await
          this.processor.processGQLEvent(gqlEvent);
        }
        // update the cursor
        lastBlockHeight = Math.max(
          lastBlockHeight,
          events?.[0]?.node?.block?.height ?? 0,
        );
        cursor = events?.[0]?.cursor;
        hasNextPage = data?.data?.transactions?.pageInfo?.hasNextPage ?? false;
      }
      this.updateLastBlockHeight(lastBlockHeight + 1);
    } catch (error) {
      this.logger.error('Error fetching events', error);
    } finally {
      this.fetching = false;
      this.logger.info(
        `Finished fetching events up to block height ${lastBlockHeight}`,
      );
    }
  }

  updateLastBlockHeight(blockHeight: number): void {
    fs.writeFileSync(this.lastBlockHeightFile, blockHeight.toString());
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
                "Buy-Name-Notice",
                "Join-Network-Notice",
                "Leave-Network-Notice"
              ]
            }          
          ],
          owners: [${authorities.map((a) => `"${a}"`).join(',')}],
          sort: HEIGHT_ASC,
          first: 100,
          block: {min: ${minBlockHeight}},
          ${cursor ? `after: "${cursor}"` : ''}
        ) {
          edges {
            cursor
            node {
              id
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
