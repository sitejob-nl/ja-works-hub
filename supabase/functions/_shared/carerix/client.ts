// GraphQL client for Carerix with rate limiting + retry.
// Rate limit is 10 req/s; we stay well under that by sleeping 120ms between calls.

const GRAPHQL_URL = 'https://api.carerix.io/graphql/v1/graphql';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const MIN_REQUEST_INTERVAL_MS = 120;

export interface GraphQLError {
  message: string;
  path?: string[];
  extensions?: Record<string, unknown>;
}

export class CarerixGraphQLClient {
  private accessToken: string;
  private lastRequestAt = 0;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  async query<T = Record<string, unknown>>(
    gql: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.throttle();

      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
          'User-Agent': 'JA-Werkt-Migration/1.0',
        },
        body: JSON.stringify({ query: gql, variables }),
      });

      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Carerix GraphQL error (${res.status}): ${text.slice(0, 500)}`);
      }

      const json = await res.json();
      if (json.errors?.length) {
        const errs = (json.errors as GraphQLError[]).map((e) => e.message).join('; ');
        throw new Error(`Carerix GraphQL errors: ${errs}`);
      }
      return json.data as T;
    }
    throw new Error('Carerix GraphQL: max retries exceeded');
  }
}
