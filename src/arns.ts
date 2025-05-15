import {
  AoARIORead,
  AoArNSLeaseData,
  AoArNSNameDataWithName,
  ARIO_MAINNET_PROCESS_ID,
  isLeasedArNSRecord,
} from '@ar.io/sdk';
import { NetworkEvent } from './db/schema.js';
import { IEventProcessor } from './processor.js';
import winston from 'winston';

interface ArNSNameProvider {
  getNames(): Promise<AoArNSNameDataWithName[]>;
}

export class SimpleCacheArNSNameProvider implements ArNSNameProvider {
  private cache: AoArNSNameDataWithName[] = [];
  private provider: ArNSNameProvider;
  private ttlSeconds: number;
  private lastUpdated: number = 0;

  constructor({
    provider,
    ttlSeconds = 60 * 60 * 1, // 1 hour,
  }: {
    provider: ArNSNameProvider;
    ttlSeconds: number;
  }) {
    this.provider = provider;
    this.ttlSeconds = ttlSeconds;
  }

  async getNames(): Promise<AoArNSNameDataWithName[]> {
    const now = Date.now();
    if (this.cache.length > 0 && this.lastUpdated + this.ttlSeconds > now) {
      return this.cache;
    }
    this.cache = await this.provider.getNames();
    this.lastUpdated = now;
    return this.cache;
  }
}

export class NetworkArNSNameProvider implements ArNSNameProvider {
  public readonly ario: AoARIORead;
  private logger: winston.Logger;
  constructor({ ario, logger }: { ario: AoARIORead; logger: winston.Logger }) {
    this.ario = ario;
    this.logger = logger.child({
      module: 'NetworkArNSNameProvider',
    });
  }

  async getNames(): Promise<AoArNSNameDataWithName[]> {
    let names: AoArNSNameDataWithName[] = [];
    let cursor: string | undefined;
    const startTime = Date.now();
    this.logger.info('Fetching all ArNS names');
    do {
      const { items: nextNames, nextCursor } = await this.ario.getArNSRecords({
        cursor,
        limit: 1000,
        sortBy: 'endTimestamp',
        sortOrder: 'asc',
      });
      names.push(...nextNames);
      cursor = nextCursor;
    } while (cursor);
    this.logger.info(`Got ${names.length} ArNS names`, {
      durationMs: Date.now() - startTime,
    });
    return names;
  }
}

export class ArNSNamePoller {
  private provider: ArNSNameProvider;
  private processor: IEventProcessor;
  private logger: winston.Logger;
  private expirationNoticeThresholdDays: number;
  constructor({
    provider,
    processor,
    logger,
    expirationNoticeThresholdDays = 365,
  }: {
    provider: ArNSNameProvider;
    processor: IEventProcessor;
    logger: winston.Logger;
    expirationNoticeThresholdDays: number;
  }) {
    this.provider = provider;
    this.processor = processor;
    this.logger = logger.child({
      module: 'ArNSNamePoller',
    });
    this.expirationNoticeThresholdDays = expirationNoticeThresholdDays;
  }

  async processArNSExpirationEvents(): Promise<void> {
    this.logger.info('Processing ArNS expiration events');
    const names = await this.provider.getNames();
    const now = Date.now();
    const thresholdTimestamp =
      now + this.expirationNoticeThresholdDays * 24 * 60 * 60 * 1000;
    const namesToProcess: (AoArNSLeaseData & { name: string })[] = names.filter(
      (name) => {
        if (isLeasedArNSRecord(name)) {
          return name.endTimestamp < thresholdTimestamp;
        }
        return false;
      },
    ) as (AoArNSLeaseData & { name: string })[];

    this.logger.info(
      `Found ${namesToProcess.length} ArNS names expiring in the next ${this.expirationNoticeThresholdDays} days`,
    );

    for (const name of namesToProcess) {
      const networkEvent: NetworkEvent = {
        id: `${name.name}-${name.endTimestamp}-${thresholdTimestamp}`,
        name: name.name,
        endTimestamp: name.endTimestamp,
        startTimestamp: name.startTimestamp,
        eventType: 'Name-Expiration-Notice',
        processId: ARIO_MAINNET_PROCESS_ID, // we don't use the processId on the arns name, since these are all on the network contract
      };
      this.logger.debug(
        `Processing ArNS expiration event for ${name.name}`,
        networkEvent,
      );
      this.processor.processNetworkEvent(networkEvent);
    }
  }
}
