import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDateInTimezone } from '../domain/periods.js';
import { SettingsRepository } from '../repositories/settingsRepository.js';
import { FinancialAuditService } from '../services/financialAuditService.js';

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const result = data => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  structuredContent: { result: data },
});

const accountSchema = z.object({
  accountKey: z.string().describe('Forecast Magic compound account key, such as plaid:123'),
});

export const createFinancialAuditMcpServer = ({
  service = new FinancialAuditService(),
  settings = new SettingsRepository(),
} = {}) => {
  const server = new McpServer({
    name: 'forecast-magic-financial-audit',
    version: '1.0.0',
  });

  server.registerTool('run_financial_health_audit', {
    title: 'Run financial health audit',
    description: 'Fetch current Lunch Money evidence, compare it with stored Capital One and n8n evidence, and save an immutable audit snapshot. This never changes financial records.',
    inputSchema: z.object({
      accountKey: accountSchema.shape.accountKey,
      anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe('Audit date in YYYY-MM-DD. Defaults to today in the Forecast Magic timezone.'),
    }),
    annotations: readOnlyAnnotations,
  }, async ({ accountKey, anchorDate }) => {
    const date = anchorDate || getDateInTimezone(new Date(), settings.get('timezone') || 'UTC');
    return result(await service.run(accountKey, date));
  });

  server.registerTool('get_latest_financial_health', {
    title: 'Get latest financial health',
    description: 'Return the latest saved audit status, confidence, facts, findings, and unknowns.',
    inputSchema: accountSchema,
    annotations: readOnlyAnnotations,
  }, async ({ accountKey }) => result(service.getLatest(accountKey)));

  server.registerTool('compare_capital_one_and_lunch_money', {
    title: 'Compare balances',
    description: 'Explain the bridge from Lunch Money synced balance through native pending and tagged n8n placeholders to Capital One available balance.',
    inputSchema: accountSchema,
    annotations: readOnlyAnnotations,
  }, async ({ accountKey }) => result(service.getBalanceBridge(accountKey)));

  server.registerTool('list_financial_audit_findings', {
    title: 'List audit findings',
    description: 'List latest audit findings, optionally filtered by severity or category.',
    inputSchema: z.object({
      accountKey: accountSchema.shape.accountKey,
      severity: z.enum(['critical', 'warning', 'unknown']).optional(),
      category: z.string().optional(),
    }),
    annotations: readOnlyAnnotations,
  }, async ({ accountKey, severity, category }) => result(
    service.getFindings(accountKey, { severity, category })
  ));

  server.registerTool('inspect_financial_audit_finding', {
    title: 'Inspect audit finding',
    description: 'Return one finding with the evidence used to create it.',
    inputSchema: z.object({
      accountKey: accountSchema.shape.accountKey,
      findingKey: z.string(),
    }),
    annotations: readOnlyAnnotations,
  }, async ({ accountKey, findingKey }) => result(service.getFinding(accountKey, findingKey)));

  server.registerTool('list_audited_transactions', {
    title: 'List audited transactions',
    description: 'List normalized Lunch Money transactions from the latest audit snapshot.',
    inputSchema: z.object({
      accountKey: accountSchema.shape.accountKey,
      source: z.string().optional().describe('Optional Lunch Money source such as plaid or api'),
      pending: z.boolean().optional(),
    }),
    annotations: readOnlyAnnotations,
  }, async ({ accountKey, source, pending }) => result(
    service.getTransactions(accountKey, { source, pending })
  ));

  server.registerTool('check_forecast_magic_tags', {
    title: 'Check transaction tags',
    description: 'Report n8n-created transactions missing Forecast Magic Pending and suspicious uses of that tag.',
    inputSchema: accountSchema,
    annotations: readOnlyAnnotations,
  }, async ({ accountKey }) => result(service.getTagCompliance(accountKey)));

  server.registerTool('check_lunch_money_sync_health', {
    title: 'Check sync health',
    description: 'Return source freshness, missing/stale import counts, settlement changes, duplicates, and overall confidence.',
    inputSchema: accountSchema,
    annotations: readOnlyAnnotations,
  }, async ({ accountKey }) => result(service.getSyncHealth(accountKey)));

  return server;
};
