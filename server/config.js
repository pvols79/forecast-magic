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
  auditReadToken: process.env.AUDIT_READ_TOKEN || '',
  auditIngestToken: process.env.AUDIT_INGEST_TOKEN || '',
  auditPendingWarningBusinessDays: Number(process.env.AUDIT_PENDING_WARNING_BUSINESS_DAYS || 3),
  auditPendingCriticalBusinessDays: Number(process.env.AUDIT_PENDING_CRITICAL_BUSINESS_DAYS || 5),
  auditStatementFreshHours: Number(process.env.AUDIT_STATEMENT_FRESH_HOURS || 36),
  lunchMoneyApiKey: process.env.LUNCH_MONEY_API_KEY || '',
  lunchMoneyBaseUrl: process.env.LUNCH_MONEY_API_BASE_URL || 'https://api.lunchmoney.dev/v2',
  isProduction: process.env.NODE_ENV === 'production',
};
