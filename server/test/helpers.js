import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { multipart } from './fixtures.js';

export const TEST_USER = 'admin';
export const TEST_PASSWORD = 'correct-horse-battery';

/** Boot an isolated app instance backed by a fresh temp DATA_DIR.
 *  `env` overrides are merged into the runtime configuration under test. */
export async function makeApp(t, env = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mm-test-'));
  const config = loadConfig({
    DATA_DIR: dataDir,
    MUSIC_AUTH_USER: TEST_USER,
    MUSIC_AUTH_PASSWORD: TEST_PASSWORD,
    ...env,
  });
  const db = openDatabase(config.dataDir);
  const app = createApp({ config, db });
  t?.onTestFinished?.(async () => {
    db.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { app, config, db, dataDir };
}

/** Log in and return the `mm_sid=...` cookie pair string. */
export async function login(app, { username = TEST_USER, password = TEST_PASSWORD } = {}) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return sidFrom(res);
}

/** Extract the `mm_sid=...` pair from a login response. */
export function sidFrom(res) {
  const cookies = res.headers['set-cookie'] ?? [];
  const sid = cookies.find((c) => c.startsWith('mm_sid='));
  return sid ? sid.split(';')[0] : null;
}

/** Upload a batch described as an ordered list of { name, data, path? } entries. */
export async function uploadFiles(app, sid, entries) {
  const parts = [];
  for (const entry of entries) {
    parts.push({
      name: 'files',
      filename: entry.name,
      contentType: entry.contentType ?? 'application/octet-stream',
      data: entry.data,
    });
    if (entry.path !== undefined) parts.push({ name: 'paths', value: entry.path });
  }
  const { body, contentType } = multipart(parts);
  return request(app)
    .post('/api/library/upload')
    .set('Cookie', sid)
    .set('Content-Type', contentType)
    .send(body);
}

export function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

/** GET returning a binary body (res.body is a Buffer). */
export function getBinary(app, url, sid) {
  const req = request(app).get(url).buffer(true).parse(binaryParser);
  return sid ? req.set('Cookie', sid) : req;
}
