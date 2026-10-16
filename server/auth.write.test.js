import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('AUDIT_READ_TOKEN', 'read-only-test');
  vi.stubEnv('AUDIT_INGEST_TOKEN', 'write-only-test');
});
afterEach(() => vi.unstubAllEnvs());

const invoke = (guard, token) => {
  const next = vi.fn();
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn(), set: vi.fn() };
  guard({ headers: { authorization: `Bearer ${token}` }, isAdmin: true }, response, next);
  return { next, response };
};

it('separates write-key MCP access from read tokens and browser admin sessions', async () => {
  const { requireMcpAuditWrite, requireMcpAuditRead } = await import('./auth.js');
  expect(invoke(requireMcpAuditWrite, 'read-only-test').response.status).toHaveBeenCalledWith(401);
  expect(invoke(requireMcpAuditWrite, '').next).not.toHaveBeenCalled();
  expect(invoke(requireMcpAuditWrite, 'write-only-test').next).toHaveBeenCalledOnce();
  expect(invoke(requireMcpAuditRead, 'write-only-test').response.status).toHaveBeenCalledWith(401);
  expect(invoke(requireMcpAuditRead, 'read-only-test').next).toHaveBeenCalledOnce();
});

it('fails closed when the write key is not configured', async () => {
  vi.stubEnv('AUDIT_INGEST_TOKEN', '');
  const { requireMcpAuditWrite } = await import('./auth.js');
  expect(invoke(requireMcpAuditWrite, 'write-only-test').response.status).toHaveBeenCalledWith(503);
});
