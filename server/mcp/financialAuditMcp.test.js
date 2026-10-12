import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createFinancialAuditMcpServer } from './financialAuditMcp.js';
import { reconciliationGuidance } from '../services/lunchMoneyReadService.js';

const connections = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map(connection => connection.close()));
});

describe('Forecast Magic audit MCP server', () => {
  it('redirects missing snapshots and historical upload instructions to live reads', async () => {
    const server = createFinancialAuditMcpServer({
      service: {
        getLatest: () => ({ status: 'not_assessable', recommendation: 'Upload CSV with an Ingest Token' }),
        getBalanceBridge: () => { throw Object.assign(new Error('No completed audit exists.'), { status: 404 }); },
      },
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    connections.push(client, server);
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    for (const name of ['get_latest_financial_health', 'compare_capital_one_and_lunch_money']) {
      const response = await client.callTool({ name, arguments: { accountKey: 'plaid:1' } });
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent.auditContext).toMatchObject({
        auditRequirements: reconciliationGuidance,
        uploadRequired: false, ingestTokenRequired: false, attachmentReconciliationBlocked: false,
        nextTools: ['get_lunch_money_reference_data', 'query_lunch_money_transactions'],
      });
      const text = JSON.parse(response.content[0].text);
      expect(text.auditContext).toEqual(response.structuredContent.auditContext);
      expect(text.historicalData).toEqual(response.structuredContent.result);
    }
  });
  it('runs a model-led audit through live reads without uploading or saving evidence', async () => {
    const calls = [];
    const reader = { getTransactions: async input => { calls.push(input); return { transactions: [], pagination: { hasMore: false } }; } };
    const server = createFinancialAuditMcpServer({ service: {}, reader, settings: { get: () => 'UTC' } });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    connections.push(client, server);
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    for (const requirement of Object.values(reconciliationGuidance)) {
      expect(client.getInstructions()).toContain(requirement);
    }
    const response = await client.callTool({ name: 'run_financial_health_audit', arguments: {
      accountKey: 'plaid:1', startDate: '2026-09-01', endDate: '2026-10-10',
    } });
    expect(response.isError).not.toBe(true);
    expect(calls[0]).toMatchObject({ accountKey: 'plaid:1', startDate: '2026-09-01', endDate: '2026-10-10', paddingDays: 5 });
    expect(response.structuredContent.result.pagination.hasMore).toBe(false);
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toContain('get_lunch_money_reference_data');
    expect(names).toContain('query_lunch_money_transactions');
  });
  it('publishes read-only conversational audit tools with structured results', async () => {
    const service = {
      getBalanceBridge: accountKey => ({ accountKey, unexplainedAvailableDifferenceCents: 0 }),
    };
    const server = createFinancialAuditMcpServer({ service, settings: { get: () => 'UTC' } });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    connections.push(client, server);
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toContain('compare_capital_one_and_lunch_money');
    expect(tools.tools.every(tool => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.tools.every(tool => tool.annotations?.destructiveHint === false)).toBe(true);

    const response = await client.callTool({
      name: 'compare_capital_one_and_lunch_money',
      arguments: { accountKey: 'plaid:123' },
    });
    expect(response.structuredContent).toMatchObject({
      auditContext: { uploadRequired: false, ingestTokenRequired: false, attachmentReconciliationBlocked: false },
      result: { accountKey: 'plaid:123', unexplainedAvailableDifferenceCents: 0 },
    });
  });

  it('publishes compact server-side audit tools', async () => {
    const service = {
      runCompactAudit: async input => ({
        auditId: 7,
        account: { key: input.accountKey },
        highPriorityFindings: [],
        responseSize: { estimatedTokens: 120 },
      }),
      getAuditFindings: input => ({
        auditId: input.auditId,
        findings: [],
        pagination: { hasMore: false },
      }),
      getAuditEvidence: input => ({
        auditId: input.auditId,
        finding: { key: input.findingKey },
        evidence: {},
      }),
    };
    const server = createFinancialAuditMcpServer({ service, settings: { get: () => 'UTC' } });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    connections.push(client, server);
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(['audit_run', 'audit_get_findings', 'audit_get_evidence']));

    const response = await client.callTool({
      name: 'audit_run',
      arguments: { accountKey: 'plaid:123', anchorDate: '2026-09-06', findingLimit: 3 },
    });
    expect(response.structuredContent.result).toMatchObject({
      auditId: 7,
      account: { key: 'plaid:123' },
      responseSize: { estimatedTokens: 120 },
    });
  });
});
