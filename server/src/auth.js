import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { httpError, parseCookies } from './util.js';

export const SESSION_COOKIE = 'mm_sid';

/** SHA-256 both sides so timingSafeEqual works regardless of length. */
export function hashCredential(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

export function credentialsMatch(a, b) {
  return crypto.timingSafeEqual(hashCredential(a), hashCredential(b));
}

const secretKey = (config) => new TextEncoder().encode(config.jwtSecret);

export async function signSession(config, username) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime(`${config.sessionDays}d`)
    .sign(secretKey(config));
}

export async function verifySession(config, token) {
  const { payload } = await jwtVerify(token, secretKey(config));
  return payload;
}

/** Per-IP failed-login throttle: maxAttempts per rolling window. */
export class LoginThrottle {
  constructor({ maxAttempts = 5, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.now = now;
    this.attempts = new Map(); // ip -> { count, firstAt }
  }

  isBlocked(ip) {
    const entry = this.attempts.get(ip);
    if (!entry) return false;
    if (this.now() - entry.firstAt >= this.windowMs) {
      this.attempts.delete(ip);
      return false;
    }
    return entry.count >= this.maxAttempts;
  }

  recordFailure(ip) {
    const now = this.now();
    const entry = this.attempts.get(ip);
    if (!entry || now - entry.firstAt >= this.windowMs) {
      this.attempts.set(ip, { count: 1, firstAt: now });
      return;
    }
    entry.count += 1;
  }

  clear(ip) {
    this.attempts.delete(ip);
  }
}

export const sessionCookieOptions = (config) => ({
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
});

/** Express middleware guarding every mounted route behind a valid session. */
export function createAuthGuard(config) {
  return async function authGuard(req, res, next) {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (!token) throw httpError(401, 'Unauthorized');
      const payload = await verifySession(config, token);
      if (!payload.sub) throw httpError(401, 'Unauthorized');
      req.user = { username: payload.sub };
      next();
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };
}
