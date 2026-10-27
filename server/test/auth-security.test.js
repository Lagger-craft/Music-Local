import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { SignJWT } from 'jose';
import { loadConfig } from '../src/config.js';
import { LoginThrottle } from '../src/auth.js';
import { makeApp, TEST_USER } from './helpers.js';

describe('auth security hardening (verify findings)', () => {
  it('treats empty or whitespace MUSIC_AUTH_PASSWORD as unset', () => {
    for (const raw of ['', '   ']) {
      const config = loadConfig({ MUSIC_AUTH_USER: 'admin', MUSIC_AUTH_PASSWORD: raw });
      expect(config.passwordGenerated).toBe(true);
      expect(config.authPassword.length).toBeGreaterThanOrEqual(16);
    }
  });

  it('rejects session tokens not signed with HS256', async () => {
    const { app, config } = await makeApp();
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS384' })
      .setSubject(TEST_USER)
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(new TextEncoder().encode(config.jwtSecret));
    const res = await request(app).get('/api/auth/me').set('Cookie', `mm_sid=${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects expired and wrong-secret session tokens', async () => {
    const { app, config } = await makeApp();
    const key = new TextEncoder().encode(config.jwtSecret);

    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(TEST_USER)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    const expiredRes = await request(app).get('/api/auth/me').set('Cookie', `mm_sid=${expired}`);
    expect(expiredRes.status).toBe(401);

    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(TEST_USER)
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(new TextEncoder().encode('other-secret'));
    const forgedRes = await request(app).get('/api/auth/me').set('Cookie', `mm_sid=${forged}`);
    expect(forgedRes.status).toBe(401);
  });

  it('never serves web/dist/api/* or falls through /api to static files', async (t) => {
    const dist = await mkdtemp(path.join(tmpdir(), 'mm-dist-'));
    await mkdir(path.join(dist, 'api'), { recursive: true });
    await writeFile(path.join(dist, 'api', 'secret.js'), 'export const secret = 1;');
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>deck</title>');
    t.onTestFinished?.(() => rm(dist, { recursive: true, force: true }));

    const { app } = await makeApp(t, { WEB_DIST: dist });
    // Guard runs before static: no cookie -> 401, not the planted file.
    const shadow = await request(app).get('/api/secret.js');
    expect(shadow.status).toBe(401);
    // The SPA itself is served for the root once authenticated.
    const sid = await loginViaHelper(app);
    const root = await request(app).get('/').set('Cookie', sid);
    expect(root.status).toBe(200);
    expect(root.text).toContain('deck');
  });

  it('marks the session cookie Secure when MUSIC_COOKIE_SECURE=true', async () => {
    const { app } = await makeApp(undefined, { MUSIC_COOKIE_SECURE: 'true' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USER, password: 'correct-horse-battery' });
    expect(res.status).toBe(200);
    const sid = (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('mm_sid='));
    expect(sid).toBeDefined();
    expect(sid).toMatch(/Secure/i);
  });

  it('interprets TRUST_PROXY=true as a single trusted hop, never trust-all', () => {
    // Trust-all would let a client pick the leftmost X-Forwarded-For entry and
    // rotate past the throttle; one hop keys on the entry the proxy appended.
    expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(1);
  });

  it('releases the throttle exactly at the window boundary', () => {
    let clock = 0;
    const throttle = new LoginThrottle({ maxAttempts: 5, windowMs: 1000, now: () => clock });
    for (let i = 0; i < 5; i++) throttle.recordFailure('198.51.100.7');
    expect(throttle.isBlocked('198.51.100.7')).toBe(true);
    clock = 999;
    expect(throttle.isBlocked('198.51.100.7')).toBe(true);
    clock = 1000;
    expect(throttle.isBlocked('198.51.100.7')).toBe(false);
  });
});

async function loginViaHelper(app) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: TEST_USER, password: 'correct-horse-battery' });
  const sid = (res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('mm_sid='))
    ?.split(';')[0];
  if (!sid) throw new Error(`login failed: ${res.status}`);
  return sid;
}
