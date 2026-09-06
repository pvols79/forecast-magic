import path from 'node:path';
import express from 'express';
import { attachAdminStatus } from './auth.js';
import { config } from './config.js';
import { createAuthRouter } from './routes/authRoutes.js';
import { createDuplicateReviewRouter } from './routes/duplicateReviewRoutes.js';
import { createFinancialAuditRouter } from './routes/financialAuditRoutes.js';
import { createFinancialAnalyticsRouter } from './routes/financialAnalyticsRoutes.js';
import { createLunchMoneyRouter } from './routes/lunchMoneyRoutes.js';
import { createMcpRouter } from './routes/mcpRoutes.js';
import { createOperationalFundRouter } from './routes/operationalFundRoutes.js';
import { createReportingRouter } from './routes/reportingRoutes.js';
import { createSettingsRouter } from './routes/settingsRoutes.js';
import { FinancialAuditService } from './services/financialAuditService.js';

export const createApp = () => {
  const app = express();
  const financialAuditService = new FinancialAuditService();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));
  app.use(attachAdminStatus);

  app.get('/api/health', (request, response) => response.json({ status: 'ok' }));
  app.use('/api/auth', createAuthRouter());
  app.use('/api/duplicate-review', createDuplicateReviewRouter());
  app.use('/api/financial-audit', createFinancialAuditRouter(financialAuditService));
  app.use('/api/analytics', createFinancialAnalyticsRouter());
  app.use('/api/reporting', createReportingRouter(
    undefined, undefined, undefined, undefined, financialAuditService
  ));
  app.use('/api/settings', createSettingsRouter());
  app.use('/api/lunch-money', createLunchMoneyRouter());
  app.use('/api/funds', createOperationalFundRouter());
  app.use('/mcp', createMcpRouter());

  app.use('/api', (request, response) => response.status(404).json({ error: 'API endpoint not found.' }));
  app.use(express.static(config.distPath));
  app.get('*path', (request, response) => response.sendFile(path.join(config.distPath, 'index.html')));

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error.status || error.response?.status || (error.code === 'CATEGORY_CONFLICT' ? 409 : 500);
    const message = error.response?.data?.message || error.message || 'Unexpected server error.';
    return response.status(status).json({ error: message, conflict: error.conflict });
  });

  return app;
};
