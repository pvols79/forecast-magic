import { describe, expect, it } from 'vitest';
import { createRequireReportingToken } from '../auth.js';
import { createReportingRouter } from './reportingRoutes.js';

const invokeGuard = (expectedToken, authorization) => {
  const result = { status: null, body: null, headers: {}, nextCalled: false };
  const response = {
    status(status) {
      result.status = status;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
    set(name, value) {
      result.headers[name] = value;
      return this;
    },
  };
  createRequireReportingToken(expectedToken)(
    { headers: { authorization } },
    response,
    () => { result.nextCalled = true; }
  );
  return result;
};

describe('Reporting API', () => {
  it('requires the configured reporting Bearer token', () => {
    expect(invokeGuard('automation-secret')).toMatchObject({
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
      nextCalled: false,
    });
    expect(invokeGuard('automation-secret', 'Bearer incorrect')).toMatchObject({
      status: 401,
      nextCalled: false,
    });
    expect(invokeGuard('automation-secret', 'Bearer automation-secret')).toMatchObject({
      status: null,
      body: null,
      nextCalled: true,
    });
  });

  it('fails closed when no reporting token is configured', () => {
    expect(invokeGuard('', 'Bearer anything')).toMatchObject({
      status: 503,
      body: { error: 'Reporting API access is not configured.' },
      nextCalled: false,
    });
  });

  it('exposes a Daily Highlight route backed by the analytics service', async () => {
    const calls = [];
    const service = {
      getDailyHighlight: async (accountKey, anchorDate) => {
        calls.push({ accountKey, anchorDate });
        return { schemaVersion: '1.0', reportDate: anchorDate, account: { key: accountKey } };
      },
    };
    const router = createReportingRouter(
      service,
      { get: () => 'America/Chicago' },
      (request, response, next) => next()
    );
    const route = router.stack.find(layer => layer.route?.path === '/daily-highlight').route;
    const handler = route.stack.at(-1).handle;
    let body;

    await handler(
      { query: { accountKey: 'plaid:1', anchorDate: '2026-08-14' } },
      { json: value => { body = value; } }
    );

    expect(route.methods.get).toBe(true);
    expect(body).toEqual({
      schemaVersion: '1.0',
      reportDate: '2026-08-14',
      account: { key: 'plaid:1' },
    });
    expect(calls).toEqual([{ accountKey: 'plaid:1', anchorDate: '2026-08-14' }]);
  });
});
