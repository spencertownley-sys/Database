import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.test', quiet: true });
loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

process.env.TZ = 'UTC';
