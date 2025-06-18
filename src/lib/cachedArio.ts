import { ARIO } from '@ar.io/sdk';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Cached wrapper around the ARIO SDK network calls used in notifications.
 * Results are cached in memory for the provided TTL (default: one hour).
 */
export class CachedArio {
  private ario = ARIO.mainnet();
  private cache = new Map<string, CacheEntry<any>>();
  private ttl: number;

  constructor(ttlMs: number = 60 * 60 * 1000) {
    this.ttl = ttlMs;
  }

  private async getCached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
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
    return this.getCached(
      `gateways:${JSON.stringify(params ?? {})}`,
      () => this.ario.getGateways(params as any),
    );
  }

  async getPrescribedObservers(epoch?: any) {
    return this.getCached(
      `observers:${JSON.stringify(epoch ?? {})}`,
      () => this.ario.getPrescribedObservers(epoch),
    );
  }

  async getObservations(epoch?: any) {
    return this.getCached(
      `observations:${JSON.stringify(epoch ?? {})}`,
      () => this.ario.getObservations(epoch),
    );
  }

  async getPrimaryName(params: { address: string } | { name: string }) {
    return this.getCached(
      `primaryName:${JSON.stringify(params)}`,
      () => this.ario.getPrimaryName(params as any),
    );
  }
}
