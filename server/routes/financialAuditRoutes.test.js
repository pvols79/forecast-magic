import { describe, expect, it, vi } from 'vitest';
import { createRequireBearerToken } from '../auth.js';
import { createFinancialAuditRouter } from './financialAuditRoutes.js';

const pass = (request, response, next) => next();

const invokeGuard = (expectedToken, authorization) => {
  const result = { status: null, body: null, headers: {}, nextCalled: false };
  const response = {
    status(value) {
      result.status = value;
      return this;
    },
    json(value) {
      result.body = value;
      return this;
    },
    set(name, value) {
      result.headers[name] = value;
      return this;
    },
  };
  createRequireBearerToken(expectedToken, { configurationName: 'Audit read API' })(
    { headers: { authorization } }, response, () => { result.nextCalled = true; }
  );
  return result;
};

const routeFor = (router, path) => router.stack.find(layer => layer.route?.path === path).route;

describe('Financial Audit API', () => {
  it('fails closed and accepts only the configured Bearer token', () => {
    expect(invokeGuard('', 'Bearer anything')).toMatchObject({
      status: 503,
      body: { error: 'Audit read API access is not configured.' },
      nextCalled: false,
    });
    expect(invokeGuard('audit-secret', 'Bearer wrong')).toMatchObject({
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
      nextCalled: false,
    });
    expect(invokeGuard('audit-secret', 'Bearer audit-secret')).toMatchObject({
      status: null,
      nextCalled: true,
    });
  });

  it('runs an account-scoped audit and returns the immutable result', async () => {
    const service = { run: vi.fn(async (accountKey, anchorDate) => ({ id: 12, accountKey, anchorDate })) };
    const router = createFinancialAuditRouter(
      service, { get: () => 'America/Chicago' }, pass, pass
    );
    const route = routeFor(router, '/runs');
    let status;
    let body;

    await route.stack.at(-1).handle(
      { body: { accountKey: 'plaid:123', anchorDate: '2026-09-06' }, query: {} },
      {
        status(value) { status = value; return this; },
        json(value) { body = value; return this; },
      }
    );

    expect(route.methods.post).toBe(true);
    expect(status).toBe(201);
    expect(body).toEqual({ id: 12, accountKey: 'plaid:123', anchorDate: '2026-09-06' });
    expect(service.run).toHaveBeenCalledWith('plaid:123', '2026-09-06');
  });

  it('keeps n8n evidence ingestion on the ingest-protected route', () => {
    const service = {
      ingestN8nEvidence: vi.fn(input => ({ ...input, stored: true })),
    };
    const router = createFinancialAuditRouter(service, { get: () => 'UTC' }, pass, pass);
    const route = routeFor(router, '/evidence/n8n');
    let status;
    let body;
    const input = {
      accountKey: 'plaid:123',
      externalId: 'n8n-capone-gmail-message-1',
      date: '2026-09-06',
      amountCents: -2194,
      payee: 'Google',
    };

    route.stack.at(-1).handle(
      { body: input },
      {
        status(value) { status = value; return this; },
        json(value) { body = value; return this; },
      }
    );

    expect(route.methods.post).toBe(true);
    expect(status).toBe(201);
    expect(body).toEqual({ ...input, stored: true });
    expect(service.ingestN8nEvidence).toHaveBeenCalledWith(input);
  });

  it('exposes separate preview and commit routes for Capital One CSV evidence', () => {
    const router = createFinancialAuditRouter({}, { get: () => 'UTC' }, pass, pass);
    const preview = routeFor(router, '/evidence/capital-one/preview');
    const commit = routeFor(router, '/evidence/capital-one');

    expect(preview.methods.post).toBe(true);
    expect(commit.methods.post).toBe(true);
    expect(preview.stack).toHaveLength(3);
    expect(commit.stack).toHaveLength(3);
  });
});
