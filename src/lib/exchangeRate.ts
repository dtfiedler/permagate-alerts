import winston from 'winston';

export class ExchangeRateService {
  private cacheDuration = 15 * 60 * 1000; // 15 minutes
  private lastFetched = 0;
  private lastRate: number | null = null;

  constructor(private logger: winston.Logger, private apiKey?: string) {}

  async getArioUsdRate(): Promise<number | null> {
    const now = Date.now();
    if (this.lastRate && now - this.lastFetched < this.cacheDuration) {
      return this.lastRate;
    }

    try {
      if (!this.apiKey) {
        this.logger.warn('MARKET_CAP_API_KEY not configured');
        return this.lastRate;
      }
      const response = await fetch(
        'https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=ARIO&convert=USD',
        {
          headers: {
            'X-CMC_PRO_API_KEY': this.apiKey,
          },
        },
      );
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      const rate = Number(data?.data?.ARIO?.quote?.USD?.price);
      if (!isNaN(rate)) {
        this.lastRate = rate;
        this.lastFetched = now;
      }
    } catch (error) {
      this.logger.error('Failed to fetch ARIO price', { error });
    }
    return this.lastRate;
  }
}
