// OAuth2 client_credentials flow against Carerix identity endpoint.
// Each edge function invocation fetches a fresh token (tokens are short-lived).

export interface CarerixCredentials {
  client_id: string;
  client_secret: string;
  token_endpoint: string;
  scope: string;
}

export interface CarerixTokenResult {
  access_token: string;
  expires_in: number;
}

export async function fetchCarerixAccessToken(creds: CarerixCredentials): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    scope: creds.scope,
  });

  const res = await fetch(creds.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Carerix OAuth token failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as CarerixTokenResult;
  return data.access_token;
}

// OpenID Configuration discovery — client provides instance URL, we resolve token endpoint.
export async function discoverTokenEndpoint(instanceUrl: string): Promise<string> {
  const url = `${instanceUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!res.ok) {
    throw new Error(
      `OpenID discovery faalde (${res.status}) op ${url}. Vul het Token endpoint handmatig in — klik in Carerix bij je client op "OpenID Configuration" en plak die URL of het token_endpoint veld in de JA Werkt UI.`,
    );
  }

  const data = await res.json();
  if (!data.token_endpoint) {
    throw new Error(`OpenID config at ${url} has no token_endpoint`);
  }
  return data.token_endpoint as string;
}

// Resolve whatever the user pasted into a concrete token_endpoint URL.
// Accepts: a direct token endpoint, an auth endpoint (auto-swapped), or a
// .well-known/openid-configuration URL.
export async function resolveTokenEndpoint(input: string): Promise<string> {
  const trimmed = input.trim().replace(/\/$/, '');

  if (trimmed.includes('/.well-known/openid-configuration')) {
    const res = await fetch(trimmed, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`OpenID discovery faalde (${res.status}) op ${trimmed}`);
    const data = await res.json();
    if (!data.token_endpoint) throw new Error(`OpenID config bevat geen token_endpoint`);
    return data.token_endpoint as string;
  }

  // Common Keycloak mistake: user pasted the authorization endpoint
  // (.../openid-connect/auth) instead of the token endpoint. Auto-swap.
  if (/\/openid-connect\/(auth|authorize)$/i.test(trimmed)) {
    return trimmed.replace(/\/openid-connect\/(auth|authorize)$/i, '/openid-connect/token');
  }

  return trimmed;
}
