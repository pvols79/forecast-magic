import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireMcpAuditRead } from '../auth.js';
import { createFinancialAuditMcpServer } from '../mcp/financialAuditMcp.js';

const methodNotAllowed = (request, response) => response.status(405).json({
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Method not allowed.' },
  id: null,
});

export const createMcpRouter = (
  serverFactory = createFinancialAuditMcpServer,
  tokenGuard = requireMcpAuditRead
) => {
  const router = Router();

  router.post('/', tokenGuard, async (request, response) => {
    const server = serverFactory();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: error.message || 'Internal server error' },
          id: null,
        });
      }
    } finally {
      await transport.close();
      await server.close();
    }
  });

  router.get('/', tokenGuard, methodNotAllowed);
  router.delete('/', tokenGuard, methodNotAllowed);
  return router;
};
