import Arweave from 'arweave';
import fs from 'fs';
import { EventProcessor } from './processor.js';

interface EventPoller {
  fetchAndProcessEvents(): Promise<void>;
}

export class GQLEventPoller implements EventPoller {
  private processId: string;
  private arweave: Arweave;
  private retries: number = 3;
  private cursorFile: string;
  private processor: EventProcessor;
  private authorities: string[];
  private gqlUrl: string;
  constructor({
    processId,
    arweave,
    retries = 3,
    processor,
    authorities,
    gqlUrl,
  }: {
    processId: string;
    arweave: Arweave;
    retries?: number;
    processor: EventProcessor;
    authorities: string[];
    gqlUrl: string;
  }) {
    this.gqlUrl = gqlUrl;
    this.processId = processId;
    this.arweave = arweave;
    this.retries = retries;
    this.processor = processor;
    this.authorities = authorities;
    // write the file for cursor to disk
    this.cursorFile = `./data/cursor-${processId}.tx`;
    if (!fs.existsSync(this.cursorFile)) {
      fs.writeFileSync(this.cursorFile, '');
    }
  }

  async getCursor(): Promise<string> {
    return fs.readFileSync(this.cursorFile, 'utf8');
  }

  async fetchAndProcessEvents(): Promise<void> {
    // fetch from gql
    // add three retries with exponential backoff
    const cursor = await this.getCursor();
    console.log('cursor', cursor);
    const query = eventsFromProcessGqlQuery({
      processId: this.processId,
      cursor: await this.getCursor(),
      authorities: this.authorities,
    });
    for (let i = 0; i < this.retries; i++) {
      try {
        const response = await fetch(this.gqlUrl, {
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
          body: query,
        }).then((res) => res.json());

        // parse the nodes to get the id
        if (response?.data?.transactions?.edges?.length === 0) {
          return;
        }

        // now get all the events
        const events = response.data.transactions.edges;
        for (const event of events) {
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
        fs.writeFileSync(
          this.cursorFile,
          // write the last event cursor
          events[0].cursor,
        );
        return;
      } catch (error) {
        if (i === this.retries - 1) throw error; // Re-throw on final attempt
        // exponential backoff
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, i) * 1000),
        );
      }
    }
  }
}

export const eventsFromProcessGqlQuery = ({
  processId,
  cursor,
  authorities,
}: {
  processId: string;
  cursor: string;
  authorities: string[];
}): string => {
  const gqlQuery = JSON.stringify({
    query: `
    query {
      transactions(
        tags: [
            { name: "From-Process", values: ["${processId}"] },
            { name: "Data-Protocol", values: ["ao"] }
          ],
          owners: [${authorities.map((a) => `"${a}"`).join(',')}],
          sort: HEIGHT_DESC,
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
            }
          }
        }
      } 

    `,
  });
  return gqlQuery;
};

export const eventsToProcessGqlQuery = ({
  processId,
  cursor,
}: {
  processId: string;
  cursor: string;
}): string => {
  // write the query
  const gqlQuery = JSON.stringify({
    query: `
      query {
        transactions(
          tags: [
            { name: "Data-Protocol", values: ["ao"] }
          ],
          recipients: ["${processId}"],
          sort: HEIGHT_ASC
          ${cursor ? `before: "${cursor}"` : ''}
        ) {
          edges {
            node {
              id
            }
          }
        }
      }
    `,
  });
  return gqlQuery;
};
