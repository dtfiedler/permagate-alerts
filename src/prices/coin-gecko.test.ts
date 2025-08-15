import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CoinGeckoService } from './coin-gecko.js';

describe('CoinGeckoService', () => {
  const service = new CoinGeckoService({
    defaultToken: 'ar-io-network',
    ttlSeconds: 3600,
  });

  describe('getPrice', () => {
    it('should fetch and return price for default token (ar-io-network)', async () => {
      const price = await service.getPrice();
      
      assert(typeof price === 'number', 'Price should be a number');
      assert(price > 0, 'Price should be greater than 0');
    });

    it('should fetch and return price for specific token (bitcoin)', async () => {
      const price = await service.getPrice('bitcoin');
      
      assert(typeof price === 'number', 'Price should be a number');
      assert(price > 0, 'Price should be greater than 0');
      assert(price > 1000, 'Bitcoin price should be significantly higher than most altcoins');
    });

    it('should throw error for invalid token', async () => {
      await assert.rejects(
        async () => await service.getPrice('invalid-token-that-does-not-exist'),
        /Price not found for token/,
        'Should throw error for invalid token'
      );
    });

    it('should use cache on subsequent calls', async () => {
      const startTime = Date.now();
      const price1 = await service.getPrice('ethereum');
      const midTime = Date.now();
      const price2 = await service.getPrice('ethereum');
      const endTime = Date.now();

      const firstCallDuration = midTime - startTime;
      const secondCallDuration = endTime - midTime;

      assert.strictEqual(price1, price2, 'Cached price should be the same');
      assert(secondCallDuration < firstCallDuration, 'Second call should be faster due to caching');
    });
  });

  describe('getPriceForTokenQuantity', () => {
    it('should calculate correct total value for quantity', async () => {
      const quantity = 5;
      const unitPrice = await service.getPrice('ethereum');
      const totalValue = await service.getPriceForTokenQuantity({
        token: 'ethereum',
        quantity,
      });

      const expectedTotal = unitPrice * quantity;
      assert.strictEqual(totalValue, expectedTotal, 'Total value should equal unit price * quantity');
    });

    it('should handle default token with quantity', async () => {
      const quantity = 10;
      const unitPrice = await service.getPrice();
      const totalValue = await service.getPriceForTokenQuantity({
        quantity,
      });

      const expectedTotal = unitPrice * quantity;
      assert.strictEqual(totalValue, expectedTotal, 'Should use default token when not specified');
    });

    it('should handle fractional quantities', async () => {
      const quantity = 0.5;
      const unitPrice = await service.getPrice('bitcoin');
      const totalValue = await service.getPriceForTokenQuantity({
        token: 'bitcoin',
        quantity,
      });

      const expectedTotal = unitPrice * quantity;
      assert.strictEqual(totalValue, expectedTotal, 'Should handle fractional quantities correctly');
    });

    it('should return 0 for quantity of 0', async () => {
      const totalValue = await service.getPriceForTokenQuantity({
        token: 'ethereum',
        quantity: 0,
      });

      assert.strictEqual(totalValue, 0, 'Total value should be 0 when quantity is 0');
    });
  });
});