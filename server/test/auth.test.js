import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { signSession, verifySession } from '../src/auth.js';
import { login, makeApp, sidFrom, TEST_PASSWORD, TEST_USER } from './helpers.js';

describe('config', () => {
  it('defaults the user to admin, data dir to ./data and generates a password when unset', () => {
    const config = loadConfig({});
    expect(config.authUser).toBe('admin');
    expect(config.passwordGenerated).toBe(true);
    expect(config.authPassword.length).toBeGreaterThanOrEqual(16);
    expect(config.port).toBe(3000);
    expect(config.dataDir.endsWith('/data')).toBe(true);
  });

  it('honours explicit env values', () => {
    const config = loadConfig({
      DATA_DIR: '/mnt/music',
      PORT: '8080',
      MUSIC_AUTH_USER: 'deck',
      MUSIC_AUTH_PASSWORD: 's3cret',
    });
    expect(config.dataDir).toBe('/mnt/music');
    expect(config.port).toBe(8080);
    expect(config.authUser).toBe('deck');
    expect(config.authPassword).toBe('s3cret');
    expect(config.passwordGenerated).toBe(false);
  });

  it('parses TRUST_PROXY into the express trust proxy setting', () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: '0' }).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(1);
  });

  it('persists a generated session secret in DATA_DIR so logins survive restarts', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mm-secret-'));

    const first = loadConfig({ DATA_DIR: dir });
    const second = loadConfig({ DATA_DIR: dir }); // simulated container reboot

    expect(first.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(second.jwtSecret).toBe(first.jwtSecret);
    const keyPath = path.join(dir, 'session.key');
    expect((await readFile(keyPath, 'utf8')).trim()).toBe(first.jwtSecret);
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
  });

  it('prefers MUSIC_AUTH_SECRET over the persisted key and never writes it to disk', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mm-secret-'));

    const config = loadConfig({ DATA_DIR: dir, MUSIC_AUTH_SECRET: 'explicit-secret' });

    expect(config.jwtSecret).toBe('explicit-secret');
    await expect(stat(path.join(dir, 'session.key'))).rejects.toThrow();
  });

  it('treats an empty MUSIC_AUTH_SECRET as unset instead of signing with a blank key', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mm-secret-'));

    const config = loadConfig({ DATA_DIR: dir, MUSIC_AUTH_SECRET: '   ' });

    expect(config.jwtSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('falls back to a per-boot secret when DATA_DIR is not writable', async () => {
    const filePath = path.join(await mkdtemp(path.join(tmpdir(), 'mm-secret-')), 'not-a-dir');
    await writeFile(filePath, '');

    const first = loadConfig({ DATA_DIR: filePath });
    const second = loadConfig({ DATA_DIR: filePath });

    expect(first.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(second.jwtSecret).not.toBe(first.jwtSecret); // ephemeral, as before
  });

  it('repairs a blank session.key on the next boot instead of staying ephemeral', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mm-secret-'));
    const keyPath = path.join(dir, 'session.key');
    await writeFile(keyPath, '   \n'); // e.g. volume provisioned with an empty file

    const first = loadConfig({ DATA_DIR: dir });

    expect(first.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect((await readFile(keyPath, 'utf8')).trim()).toBe(first.jwtSecret);
    expect(loadConfig({ DATA_DIR: dir }).jwtSecret).toBe(first.jwtSecret);
  });

  it('replaces corrupt session.key content instead of signing with it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mm-secret-'));
    const keyPath = path.join(dir, 'session.key');
    await writeFile(keyPath, 'changeme\n');

    const config = loadConfig({ DATA_DIR: dir });

    expect(config.jwtSecret).not.toBe('changeme');
    expect(config.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect((await readFile(keyPath, 'utf8')).trim()).toBe(config.jwtSecret);
  });

  it('a token signed before a restart verifies after it; a foreign secret is rejected', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mm-secret-'));
    const boot1 = loadConfig({ DATA_DIR: dir });
    const boot2 = loadConfig({ DATA_DIR: dir }); // simulated container reboot

    const token = await signSession(boot1, TEST_USER);
    expect((await verifySession(boot2, token)).sub).toBe(TEST_USER);
    await expect(verifySession({ ...boot2, jwtSecret: 'other-secret' }, token)).rejects.toThrow();
  });
});

describe('auth', () => {
  it('GET /api/health responds 200 {ok:true} without auth', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects authenticated routes without a cookie', async () => {
    const { app } = await makeApp();
    for (const route of [
      '/api/tracks',
      '/api/library/overview',
      '/api/playlists',
      '/api/auth/me',
    ]) {
      const res = await request(app).get(route);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    }
  });

  it('rejects bad credentials with 401', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USER, password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('logs in with env credentials and sets an httpOnly SameSite=Lax cookie', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USER, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { username: TEST_USER } });
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const sid = cookies.find((c) => c.startsWith('mm_sid='));
    expect(sid).toBeDefined();
    expect(sid).toMatch(/HttpOnly/i);
    expect(sid).toMatch(/SameSite=Lax/i);
    expect(sid).toMatch(/Max-Age=2592000|Expires=/i); // 30 days
  });

  it('GET /api/auth/me returns the user with a valid cookie and 401 without one', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USER, password: TEST_PASSWORD });
    const sid = sidFrom(res);
    expect(sid).toBeTruthy();

    const me = await request(app).get('/api/auth/me').set('Cookie', sid);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ user: { username: TEST_USER } });

    const anon = await request(app).get('/api/auth/me');
    expect(anon.status).toBe(401);
  });

  it('rejects a tampered cookie with 401', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USER, password: TEST_PASSWORD });
    const sid = sidFrom(res);
    const tampered = sid.replace(/.$/, sid.at(-1) === 'A' ? 'B' : 'A');
    const me = await request(app).get('/api/auth/me').set('Cookie', tampered);
    expect(me.status).toBe(401);
  });

  it('logs out with 204 and clears the session cookie', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USER, password: TEST_PASSWORD });
    const sid = sidFrom(res);

    const out = await request(app).post('/api/auth/logout').set('Cookie', sid);
    expect(out.status).toBe(204);
    const cleared = (out.headers['set-cookie'] ?? []).join(';');
    expect(cleared).toMatch(/mm_sid=;?/i);
    expect(cleared).toMatch(/Max-Age=0|Expires=/i);

    // A request without a cookie is rejected.
    const me = await request(app).get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  it('throttles login per IP: 5 failures then 429', async () => {
    const { app } = await makeApp();
    const attempt = (password) =>
      request(app).post('/api/auth/login').send({ username: TEST_USER, password });

    for (let i = 0; i < 5; i++) {
      const res = await attempt('nope');
      expect(res.status).toBe(401);
    }
    const throttled = await attempt('nope');
    expect(throttled.status).toBe(429);
    expect(throttled.body).toHaveProperty('error');
    // Even correct credentials are rejected while throttled.
    const correct = await attempt(TEST_PASSWORD);
    expect(correct.status).toBe(429);
  });

  it('ignores spoofed X-Forwarded-For when TRUST_PROXY is unset (shared bucket)', async () => {
    const { app } = await makeApp();
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `10.0.0.${i + 1}`)
        .send({ username: TEST_USER, password: 'nope' });
      expect(res.status).toBe(401);
    }
    // Different spoofed source must not reset the bucket.
    const throttled = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '10.0.0.99')
      .send({ username: TEST_USER, password: 'nope' });
    expect(throttled.status).toBe(429);
  });

  it('keys the throttle on the forwarded client IP when TRUST_PROXY=1', async () => {
    const { app } = await makeApp(undefined, { TRUST_PROXY: '1' });
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.7')
        .send({ username: TEST_USER, password: 'nope' });
      expect(res.status).toBe(401);
    }
    // The forwarded client that exhausted its bucket is throttled...
    const blocked = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.7')
      .send({ username: TEST_USER, password: 'nope' });
    expect(blocked.status).toBe(429);
    // ...while another forwarded client keeps its own bucket.
    const other = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.8')
      .send({ username: TEST_USER, password: 'nope' });
    expect(other.status).toBe(401);
  });
});
