import { AoARIORead, ARIO } from '@ar.io/sdk';
import { Logger } from 'winston';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Cached wrapper around the ARIO SDK network calls used in notifications.
 * Results are cached in memory for the provided TTL (default: one hour).
 */
export class CachedArio {
  private ario: AoARIORead;
  private cache = new Map<string, CacheEntry<any>>();
  private ttl: number;
  private logger?: Logger;
  constructor({
    ttlMs = 60 * 60 * 1000,
    ario = ARIO.mainnet(),
    logger,
  }: {
    ttlMs?: number;
    ario?: AoARIORead;
    logger?: Logger;
  }) {
    this.ttl = ttlMs;
    this.ario = ario;
    this.logger = logger;
    this.refresh();
  }

  public async refresh() {
    this.logger?.info('Refreshing ARIO cache');
    this.cache.clear();
    this.getGateways();
    this.getPrescribedObservers();
    this.getObservations();
    this.logger?.info('ARIO cache refreshed');
  }

  private async getCached<T>(
    key: string,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const now = Date.now();
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (entry && entry.expiresAt > now) {
      return entry.value;
    }
    const value = await fetcher();
    this.cache.set(key, { value, expiresAt: now + this.ttl });
    return value;
  }

  async getGateway(params: { address: string }) {
    return this.getCached(`gateway:${params.address}`, () =>
      this.ario.getGateway(params),
    );
  }

  async getGateways(params?: Record<string, unknown>) {
    return this.getCached(`gateways:${JSON.stringify(params ?? {})}`, () =>
      this.ario.getGateways(params as any),
    );
  }

  async getPrescribedObservers(epoch?: any) {
    return this.getCached(`observers:${JSON.stringify(epoch ?? {})}`, () =>
      this.ario.getPrescribedObservers(epoch),
    );
  }

  async getObservations(epoch?: any) {
    return this.getCached(`observations:${JSON.stringify(epoch ?? {})}`, () =>
      this.ario.getObservations(epoch),
    );
  }

  async getPrimaryName(params: { address: string } | { name: string }) {
    return this.getCached(`primaryName:${JSON.stringify(params)}`, () =>
      this.ario.getPrimaryName(params as any),
    );
  }
}
