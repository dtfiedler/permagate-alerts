import { AoARIORead } from '@ar.io/sdk';
import { Logger } from 'winston';
import { SqliteDatabase } from '../db/sqlite.js';

interface ArNSSyncOptions {
  ario: AoARIORead;
  db: SqliteDatabase;
  logger: Logger;
  resolverBaseUrl?: string;
}

interface ResolverResponse {
  owner?: string;
  txId?: string;
}

/**
 * Service to sync ArNS leased name data from the AR.IO network.
 * Fetches all leased names and their owners, storing them for expiration tracking.
 */
export class ArNSSyncService {
  private ario: AoARIORead;
  private db: SqliteDatabase;
  private logger: Logger;
  private resolverBaseUrl: string;

  constructor(options: ArNSSyncOptions) {
    this.ario = options.ario;
    this.db = options.db;
    this.logger = options.logger.child({ module: 'ArNSSyncService' });
    this.resolverBaseUrl =
      options.resolverBaseUrl || 'https://permagate.io/ar-io/resolver';
  }

  /**
   * Fetches all leased ArNS records and syncs them to the database.
   * Only fetches leased names (not permabuys) since they have expirations.
   */
  async syncAllArNSNames(): Promise<void> {
    this.logger.info('Starting ArNS leased names sync');

    try {
      let cursor: string | undefined;
      let totalSynced = 0;
      let totalErrors = 0;

      do {
        const result = await this.ario.getArNSRecords({
          cursor,
          limit: 1000,
          sortBy: 'name',
          sortOrder: 'asc',
          filters: { type: 'lease' },
        });

        for (const [name, record] of Object.entries(result.items)) {
          // Skip permabuy names - they don't expire
          if (record.type === 'permabuy') {
            continue;
          }

          try {
            // Fetch owner from resolver
            const resolverData = await this.fetchFromResolver(name);

            await this.db.upsertArNSName({
              name,
              process_id: record.processId,
              owner: resolverData?.owner || '',
              root_tx_id: resolverData?.txId || null,
              end_timestamp: record.endTimestamp!,
              start_timestamp: record.startTimestamp,
            });

            totalSynced++;
          } catch (error) {
            totalErrors++;
            this.logger.error('Error syncing ArNS name', {
              name,
              error: (error as Error).message,
            });
          }
        }

        cursor = result.nextCursor;
        this.logger.debug('Synced batch of ArNS names', {
          count: Object.keys(result.items).length,
          hasMore: result.hasMore,
          totalSynced,
        });
      } while (cursor);

      this.logger.info('Completed ArNS leased names sync', {
        totalSynced,
        totalErrors,
      });
    } catch (error) {
      this.logger.error('Error during ArNS sync', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Fetches owner and transaction info from the permagate resolver.
   */
  private async fetchFromResolver(
    name: string,
  ): Promise<ResolverResponse | null> {
    try {
      const response = await fetch(`${this.resolverBaseUrl}/${name}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        this.logger.warn('Failed to fetch from resolver', {
          name,
          status: response.status,
        });
        return null;
      }

      const data = (await response.json()) as ResolverResponse;
      return data;
    } catch (error) {
      this.logger.warn('Error fetching from resolver', {
        name,
        error: (error as Error).message,
      });
      return null;
    }
  }
}
