import type { Config } from '../config.js';
import type { CarerixAuth } from './carerix-auth.js';
import type { CRPageResponse } from '../types/carerix.js';
import type winston from 'winston';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export class CarerixClient {
  private config: Config['carerix'];
  private auth: CarerixAuth;
  private logger: winston.Logger;

  // Token bucket rate limiter: 10 req/s
  private tokens = 10;
  private maxTokens = 10;
  private lastRefill = Date.now();

  constructor(config: Config['carerix'], auth: CarerixAuth, logger: winston.Logger) {
    this.config = config;
    this.auth = auth;
    this.logger = logger;
  }

  private async waitForToken(): Promise<void> {
    while (true) {
      const now = Date.now();
      const elapsed = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * 10);
      this.lastRefill = now;

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      // Wait until at least 1 token is available
      const waitMs = Math.ceil((1 - this.tokens) / 10 * 1000);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  async query<T = any>(gql: string, variables?: Record<string, any>): Promise<T> {
    await this.waitForToken();

    const token = await this.auth.getAccessToken();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(this.config.graphqlUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'JA-Werkt-Migration/1.0',
          },
          body: JSON.stringify({ query: gql, variables }),
        });

        if (res.status === 429 || res.status >= 500) {
          if (attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_MS * Math.pow(2, attempt);
            this.logger.warn(`Carerix API ${res.status}, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
        }

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Carerix GraphQL error (${res.status}): ${text}`);
        }

        const json = await res.json();

        if (json.errors?.length) {
          throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
        }

        return json.data as T;
      } catch (err) {
        if (attempt < MAX_RETRIES && (err as any)?.code === 'ECONNRESET') {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt);
          this.logger.warn(`Connection reset, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }

    throw new Error('Max retries exceeded');
  }

  async *paginateAll<T>(
    buildQuery: (pageNumber: number, pageSize: number) => string,
    extractPage: (data: any) => CRPageResponse<T>,
    pageSize = 100,
  ): AsyncGenerator<T> {
    let pageNumber = 0;
    let totalElements = Infinity;

    while (pageNumber * pageSize < totalElements) {
      const gql = buildQuery(pageNumber, pageSize);
      const data = await this.query(gql);
      const page = extractPage(data);

      totalElements = page.totalElements;

      this.logger.debug(`Page ${pageNumber}: ${page.items.length} items (total: ${totalElements})`);

      for (const item of page.items) {
        yield item;
      }

      pageNumber++;
    }
  }

  // Fetch a single entity by ID with specific fields
  async fetchOne<T>(entityType: string, id: string, fields: string): Promise<T | null> {
    const gql = `query { ${entityType}(_id: ${id}) { ${fields} } }`;
    const data = await this.query(gql);
    return data[entityType] || null;
  }
}
