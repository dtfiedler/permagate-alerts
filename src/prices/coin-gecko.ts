interface CacheEntry {
  price: number;
  timestamp: number;
}

export interface IPriceService {
  getPrice(token?: string): Promise<number>;
  getPriceForTokenQuantity({
    token,
    quantity,
  }: {
    token?: string;
    quantity: number;
  }): Promise<number>;
}

export class CoinGeckoService implements IPriceService {
  private defaultToken: string;
  private baseUrl = 'https://api.coingecko.com/api/v3';
  private cache = new Map<string, CacheEntry>();
  private ttlMilliseconds: number;

  constructor({
    defaultToken = 'ar-io-network',
    ttlSeconds = 3600,
  }: {
    defaultToken?: string;
    ttlSeconds?: number;
  }) {
    this.defaultToken = defaultToken;
    this.ttlMilliseconds = ttlSeconds * 1000;
  }

  async getPrice(token?: string): Promise<number> {
    const tokenId = token || this.defaultToken;
    const cacheKey = tokenId.toLowerCase();

    const cachedEntry = this.cache.get(cacheKey);
    if (
      cachedEntry &&
      Date.now() - cachedEntry.timestamp < this.ttlMilliseconds
    ) {
      return cachedEntry.price;
    }

    const response = await fetch(
      `${this.baseUrl}/simple/price?ids=${cacheKey}&vs_currencies=usd`,
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch price for ${tokenId}: ${response.status}`,
      );
    }

    const data = await response.json();
    const price = data[cacheKey]?.usd;

    if (price === undefined) {
      throw new Error(`Price not found for token: ${tokenId}`);
    }

    this.cache.set(cacheKey, { price, timestamp: Date.now() });
    return price;
  }

  async getPriceForTokenQuantity({
    token,
    quantity,
  }: {
    token?: string;
    quantity: number;
  }): Promise<number> {
    const price = await this.getPrice(token);
    return price * quantity;
  }
}
