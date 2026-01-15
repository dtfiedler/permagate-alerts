import { Logger } from 'winston';

export interface HealthcheckResult {
  success: boolean;
  responseTimeMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
}

interface GatewayHealthcheckServiceOptions {
  logger: Logger;
  timeoutMs?: number;
}

/**
 * Service to perform healthchecks against AR.IO gateways.
 * Checks the /ar-io/info endpoint to verify gateway is responding.
 */
export class GatewayHealthcheckService {
  private logger: Logger;
  private timeoutMs: number;

  constructor(options: GatewayHealthcheckServiceOptions) {
    this.logger = options.logger.child({ module: 'GatewayHealthcheckService' });
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  /**
   * Performs a healthcheck against the specified gateway.
   * @param fqdn The fully qualified domain name of the gateway
   * @returns HealthcheckResult with success status and timing info
   */
  async checkGateway(fqdn: string): Promise<HealthcheckResult> {
    const url = `https://${fqdn}/ar-io/info`;
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          Accept: 'application/json',
        },
      });

      const responseTimeMs = Date.now() - startTime;

      if (response.ok) {
        this.logger.debug('Gateway healthcheck succeeded', {
          fqdn,
          statusCode: response.status,
          responseTimeMs,
        });

        return {
          success: true,
          responseTimeMs,
          statusCode: response.status,
          errorMessage: null,
        };
      } else {
        const errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        this.logger.debug('Gateway healthcheck failed with HTTP error', {
          fqdn,
          statusCode: response.status,
          errorMessage,
        });

        return {
          success: false,
          responseTimeMs,
          statusCode: response.status,
          errorMessage,
        };
      }
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      let errorMessage: string;

      if (error instanceof Error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          errorMessage = `Connection timeout after ${this.timeoutMs}ms`;
        } else {
          // Check for nested cause (e.g., certificate errors from fetch)
          const cause = (error as any).cause as Error & { code?: string };
          if (cause?.message && cause?.code) {
            errorMessage = `${cause.message} (${cause.code})`;
          } else if (cause?.message) {
            errorMessage = cause.message;
          } else {
            errorMessage = error.message;
          }
        }
      } else {
        errorMessage = 'Unknown error';
      }

      this.logger.debug('Gateway healthcheck failed with error', {
        fqdn,
        errorMessage,
        responseTimeMs,
      });

      return {
        success: false,
        responseTimeMs,
        statusCode: null,
        errorMessage,
      };
    }
  }
}
