import crypto from 'node:crypto';
import { config } from './config.js';

const COOKIE_NAME = 'cashflow_admin';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const sign = value => crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');

const parseCookies = header => Object.fromEntries(
  (header || '').split(';').map(value => value.trim()).filter(Boolean).map(value => {
    const separator = value.indexOf('=');
    return [value.slice(0, separator), decodeURIComponent(value.slice(separator + 1))];
  })
);

const createToken = () => {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_DURATION_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
};

const verifyToken = token => {
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = sign(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp > Date.now();
  } catch {
    return false;
  }
};

export const attachAdminStatus = (request, response, next) => {
  request.isAdmin = !config.adminPassword || verifyToken(parseCookies(request.headers.cookie)[COOKIE_NAME]);
  next();
};

export const requireAdmin = (request, response, next) => {
  if (request.isAdmin) return next();
  return response.status(401).json({ error: 'Admin access is required.' });
};

const tokensMatch = (provided, expected) => {
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
};

export const createRequireReportingToken = expectedToken => (request, response, next) => {
  if (!expectedToken) {
    return response.status(503).json({ error: 'Reporting API access is not configured.' });
  }
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '');
  if (!match || !tokensMatch(match[1], expectedToken)) {
    response.set('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'A valid reporting API token is required.' });
  }
  return next();
};

export const requireReportingToken = createRequireReportingToken(config.reportingApiToken);

export const login = (request, response) => {
  if (!config.adminPassword || request.body?.password === config.adminPassword) {
    const secure = request.secure || request.headers['x-forwarded-proto'] === 'https';
    response.cookie(COOKIE_NAME, createToken(), {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: SESSION_DURATION_MS,
    });
    return response.json({ isAdmin: true });
  }
  return response.status(401).json({ error: 'Incorrect password.' });
};

export const logout = (request, response) => {
  response.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax' });
  response.status(204).end();
};
