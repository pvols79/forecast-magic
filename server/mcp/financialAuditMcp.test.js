import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createFinancialAuditMcpServer } from './financialAuditMcp.js';

const connections = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map(connection => connection.close()));
});

describe('Forecast Magic audit MCP server', () => {
  it('runs a model-led audit through live reads without uploading or saving evidence', async () => {
    const calls = [];
    const reader = { getTransactions: async input => { calls.push(input); return { transactions: [], pagination: { hasMore: false } }; } };
    const server = createFinancialAuditMcpServer({ service: {}, reader, settings: { get: () => 'UTC' } });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    connections.push(client, server);
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
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
    expect(response.structuredContent).toEqual({
      result: { accountKey: 'plaid:123', unexplainedAvailableDifferenceCents: 0 },
    });
  });
});
