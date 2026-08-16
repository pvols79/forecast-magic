import { describe, expect, it, vi } from 'vitest';
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
      buildDailyHighlightReport: async (accountKey, anchorDate, context) => {
        calls.push({ accountKey, anchorDate, context });
        return { schemaVersion: '1.2', reportDate: anchorDate, account: { key: accountKey } };
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
      { query: { accountKey: 'plaid:1', anchorDate: '2026-08-14', view: 'household' } },
      { json: value => { body = value; } }
    );

    expect(route.methods.get).toBe(true);
    expect(body).toEqual({
      schemaVersion: '1.2',
      reportDate: '2026-08-14',
      account: { key: 'plaid:1' },
    });
    expect(calls).toEqual([{
      accountKey: 'plaid:1',
      anchorDate: '2026-08-14',
      context: { view: 'household', timezone: 'America/Chicago', currency: 'USD' },
    }]);
  });

  it('streams a current Household PDF through the normal application context', async () => {
    const calls = [];
    const service = {
      buildDailyHighlightReport: async (accountKey, anchorDate, context) => {
        calls.push({ accountKey, anchorDate, context });
        return { reportDate: anchorDate, account: { name: 'Main Checking' } };
      },
    };
    const pdfRenderer = vi.fn((report, response) => response.end(Buffer.from('%PDF-test')));
    const router = createReportingRouter(
      service,
      { get: () => 'America/Chicago' },
      (request, response, next) => next(),
      pdfRenderer
    );
    const route = router.stack.find(layer => layer.route?.path === '/daily-highlight.pdf').route;
    const headers = {};
    let content;
    await route.stack.at(-1).handle(
      {
        isAdmin: false,
        query: { accountKey: 'plaid:1', anchorDate: '2026-08-14', view: 'household' },
      },
      {
        setHeader: (name, value) => { headers[name] = value; },
        end: value => { content = value; },
      }
    );

    expect(headers).toMatchObject({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="forecast-magic-daily-highlight-2026-08-14-main-checking.pdf"',
    });
    expect(content.length).toBeGreaterThan(0);
    expect(pdfRenderer).toHaveBeenCalledOnce();
    expect(calls[0].context.view).toBe('household');
  });

  it('requires an Admin session for an Admin PDF', async () => {
    const service = { buildDailyHighlightReport: vi.fn() };
    const router = createReportingRouter(service, { get: () => 'UTC' });
    const route = router.stack.find(layer => layer.route?.path === '/daily-highlight.pdf').route;
    const result = { status: null, body: null };
    await route.stack.at(-1).handle(
      { isAdmin: false, query: { accountKey: 'plaid:1', view: 'admin' } },
      {
        status: value => {
          result.status = value;
          return { json: body => { result.body = body; } };
        },
      }
    );
    expect(result).toEqual({
      status: 401,
      body: { error: 'Admin access is required for an Admin report.' },
    });
    expect(service.buildDailyHighlightReport).not.toHaveBeenCalled();
  });
});
