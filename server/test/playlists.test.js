import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makeWav } from './fixtures.js';
import { login, makeApp, uploadFiles } from './helpers.js';

async function seedTracks(app, sid, n = 3) {
  const entries = [];
  for (let i = 1; i <= n; i++) {
    entries.push({
      name: `track${i}.wav`,
      path: `track${i}.wav`,
      data: makeWav({ title: `Track ${i}`, artist: `Artist ${i}`, album: `Album ${i}` }),
    });
  }
  const res = await uploadFiles(app, sid, entries);
  expect(res.status).toBe(200);
  return res.body.tracks;
}

describe('PUT /api/tracks/:id/favorite', () => {
  it('toggles a favorite and persists it', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const [track] = await seedTracks(app, sid, 1);

    const on = await request(app)
      .put(`/api/tracks/${track.id}/favorite`)
      .set('Cookie', sid)
      .send({ favorite: true });
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ favorite: true });

    // Persistence: reflected in listings.
    const list = await request(app).get('/api/tracks').set('Cookie', sid);
    expect(list.body.items[0].favorite).toBe(true);

    // Idempotent repeat.
    const again = await request(app)
      .put(`/api/tracks/${track.id}/favorite`)
      .set('Cookie', sid)
      .send({ favorite: true });
    expect(again.body).toEqual({ favorite: true });

    const off = await request(app)
      .put(`/api/tracks/${track.id}/favorite`)
      .set('Cookie', sid)
      .send({ favorite: false });
    expect(off.body).toEqual({ favorite: false });
    const after = await request(app).get('/api/tracks').set('Cookie', sid);
    expect(after.body.items[0].favorite).toBe(false);
  });

  it('returns 404 for unknown tracks and 400 for a bad payload', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const missing = await request(app)
      .put('/api/tracks/00000000-0000-0000-0000-000000000000/favorite')
      .set('Cookie', sid)
      .send({ favorite: true });
    expect(missing.status).toBe(404);

    const [track] = await seedTracks(app, sid, 1);
    const bad = await request(app)
      .put(`/api/tracks/${track.id}/favorite`)
      .set('Cookie', sid)
      .send({ favorite: 'yes' });
    expect(bad.status).toBe(400);
    expect(bad.body).toHaveProperty('error');
  });
});

describe('playlists CRUD', () => {
  it('creates, lists, renames and deletes playlists', async () => {
    const { app } = await makeApp();
    const sid = await login(app);

    const created = await request(app)
      .post('/api/playlists')
      .set('Cookie', sid)
      .send({ name: 'Road Trip' });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.body.name).toBe('Road Trip');
    expect(created.body.trackCount).toBe(0);

    const list = await request(app).get('/api/playlists').set('Cookie', sid);
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([
      { id: created.body.id, name: 'Road Trip', trackCount: 0 },
    ]);

    const renamed = await request(app)
      .patch(`/api/playlists/${created.body.id}`)
      .set('Cookie', sid)
      .send({ name: 'Night Drive' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Night Drive');

    const del = await request(app)
      .delete(`/api/playlists/${created.body.id}`)
      .set('Cookie', sid);
    expect(del.status).toBe(204);

    const after = await request(app).get('/api/playlists').set('Cookie', sid);
    expect(after.body.items).toEqual([]);
  });

  it('returns 404 for operations on unknown playlists', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const ghost = '00000000-0000-0000-0000-000000000000';
    for (const [method, url] of [
      ['patch', `/api/playlists/${ghost}`],
      ['delete', `/api/playlists/${ghost}`],
      ['get', `/api/playlists/${ghost}/tracks`],
    ]) {
      const res = await request(app)
        [method](url)
        .set('Cookie', sid)
        .send({ name: 'x', trackIds: [] });
      expect(res.status, `${method} ${url}`).toBe(404);
    }
  });

  it('validates the create/rename payloads', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const noName = await request(app).post('/api/playlists').set('Cookie', sid).send({});
    expect(noName.status).toBe(400);
    const blankName = await request(app)
      .post('/api/playlists')
      .set('Cookie', sid)
      .send({ name: '   ' });
    expect(blankName.status).toBe(400);
  });
});

describe('playlist tracks', () => {
  it('replaces the full track list in array order and lists with positions', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const tracks = await seedTracks(app, sid, 3);
    const pl = await request(app)
      .post('/api/playlists')
      .set('Cookie', sid)
      .send({ name: 'Mix' });

    const first = await request(app)
      .put(`/api/playlists/${pl.body.id}/tracks`)
      .set('Cookie', sid)
      .send({ trackIds: [tracks[2].id, tracks[0].id, tracks[1].id] });
    expect(first.status).toBe(200);
    expect(first.body.items.map((t) => t.title)).toEqual(['Track 3', 'Track 1', 'Track 2']);
    expect(first.body.items.map((t) => t.position)).toEqual([0, 1, 2]);
    expect(first.body.items[0]).toMatchObject({ id: tracks[2].id, favorite: false });

    // Full replace shrinks the list.
    const replaced = await request(app)
      .put(`/api/playlists/${pl.body.id}/tracks`)
      .set('Cookie', sid)
      .send({ trackIds: [tracks[1].id, tracks[2].id] });
    expect(replaced.body.items.map((t) => t.title)).toEqual(['Track 2', 'Track 3']);
    expect(replaced.body.items.map((t) => t.position)).toEqual([0, 1]);

    // GET reflects the stored order and positions.
    const listed = await request(app)
      .get(`/api/playlists/${pl.body.id}/tracks`)
      .set('Cookie', sid);
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((t) => t.title)).toEqual(['Track 2', 'Track 3']);
    expect(listed.body.items.map((t) => t.position)).toEqual([0, 1]);

    // trackCount in the index follows membership.
    const list = await request(app).get('/api/playlists').set('Cookie', sid);
    expect(list.body.items[0].trackCount).toBe(2);
  });

  it('clears the list when replaced with an empty array', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const tracks = await seedTracks(app, sid, 2);
    const pl = await request(app)
      .post('/api/playlists')
      .set('Cookie', sid)
      .send({ name: 'Ephemeral' });
    await request(app)
      .put(`/api/playlists/${pl.body.id}/tracks`)
      .set('Cookie', sid)
      .send({ trackIds: [tracks[0].id] });

    const cleared = await request(app)
      .put(`/api/playlists/${pl.body.id}/tracks`)
      .set('Cookie', sid)
      .send({ trackIds: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.items).toEqual([]);

    const listed = await request(app)
      .get(`/api/playlists/${pl.body.id}/tracks`)
      .set('Cookie', sid);
    expect(listed.body.items).toEqual([]);
  });

  it('rejects unknown track ids and bad payloads', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const tracks = await seedTracks(app, sid, 1);
    const pl = await request(app)
      .post('/api/playlists')
      .set('Cookie', sid)
      .send({ name: 'Validation' });

    const ghost = await request(app)
      .put(`/api/playlists/${pl.body.id}/tracks`)
      .set('Cookie', sid)
      .send({ trackIds: [tracks[0].id, '00000000-0000-0000-0000-000000000000'] });
    expect(ghost.status).toBe(404);
    expect(ghost.body).toHaveProperty('error');

    const missingField = await request(app)
      .put(`/api/playlists/${pl.body.id}/tracks`)
      .set('Cookie', sid)
      .send({});
    expect(missingField.status).toBe(400);

    // The rejected payload must not change stored membership.
    const listed = await request(app)
      .get(`/api/playlists/${pl.body.id}/tracks`)
      .set('Cookie', sid);
    expect(listed.body.items).toEqual([]);
  });
});
