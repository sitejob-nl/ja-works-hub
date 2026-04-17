import type { Config } from '../config.js';
import type winston from 'winston';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export class CarerixAuth {
  private token: string | null = null;
  private expiresAt = 0;
  private config: Config['carerix'];
  private logger: winston.Logger;

  constructor(config: Config['carerix'], logger: winston.Logger) {
    this.config = config;
    this.logger = logger;
  }

  async getAccessToken(): Promise<string> {
    // Refresh 60s before expiry
    if (this.token && Date.now() < this.expiresAt - 60_000) {
      return this.token;
    }

    this.logger.info('Requesting new Carerix OAuth2 token...');

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scope,
    });

    const res = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OAuth2 token request failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as TokenResponse;
    this.token = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;

    this.logger.info('Carerix OAuth2 token acquired', {
      expiresIn: data.expires_in,
    });

    return this.token;
  }
}
