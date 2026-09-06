import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createFinancialAuditMcpServer } from './financialAuditMcp.js';

const connections = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map(connection => connection.close()));
});

describe('Forecast Magic audit MCP server', () => {
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
