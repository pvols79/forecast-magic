import crypto from 'node:crypto';
import path from 'node:path';

const projectRoot = process.cwd();

export const config = {
  port: Number(process.env.PORT || 3000),
  databasePath: path.resolve(process.env.DATABASE_PATH || path.join(projectRoot, 'data', 'app.db')),
  distPath: path.resolve(projectRoot, 'dist'),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  reportingApiToken: process.env.REPORTING_API_TOKEN || '',
  lunchMoneyApiKey: process.env.LUNCH_MONEY_API_KEY || '',
  lunchMoneyBaseUrl: process.env.LUNCH_MONEY_API_BASE_URL || 'https://api.lunchmoney.dev/v2',
  isProduction: process.env.NODE_ENV === 'production',
};
