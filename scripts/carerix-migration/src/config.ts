import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '..', '.env') });

export interface Config {
  carerix: {
    graphqlUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scope: string;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
  organizationId: string;
  dryRun: boolean;
  batchSize: number;
  storageBucket: string;
}

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export function loadConfig(): Config {
  const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';

  return Object.freeze({
    carerix: {
      graphqlUrl: required('CARERIX_GRAPHQL_URL'),
      tokenUrl: required('CARERIX_TOKEN_URL'),
      clientId: required('CARERIX_CLIENT_ID'),
      clientSecret: required('CARERIX_CLIENT_SECRET'),
      scope: process.env.CARERIX_SCOPE || 'urn:cx/cx5Wrapper:data:manage',
    },
    supabase: {
      url: required('SUPABASE_URL'),
      serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    },
    organizationId: required('ORGANIZATION_ID'),
    dryRun,
    batchSize: parseInt(process.env.BATCH_SIZE || '100', 10),
    storageBucket: process.env.STORAGE_BUCKET || 'documents',
  });
}
