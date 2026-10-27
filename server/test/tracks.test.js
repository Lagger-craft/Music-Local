import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makeJpeg, makeMp3, makeWav } from './fixtures.js';
import { binaryParser, getBinary, login, makeApp, uploadFiles } from './helpers.js';

/** Seed a small library: three tracks across two artists and two albums. */
async function seed(app, sid) {
  const res = await uploadFiles(app, sid, [
    {
      name: '01 - alpha.mp3',
      path: 'Album One/01 - alpha.mp3',
      data: makeMp3({ title: 'Alpha', artist: 'Artist A', album: 'Album One', track: 1, picture: { data: makeJpeg(1) } }),
    },
    {
      name: '02 - beta.mp3',
      path: 'Album One/02 - beta.mp3',
      data: makeMp3({ title: 'Beta', artist: 'Artist A', album: 'Album One', track: 2 }),
    },
    {
      name: 'gamma.wav',
      path: 'gamma.wav',
      data: makeWav({ title: 'Gamma', artist: 'Artist B', album: 'Album Two' }),
    },
  ]);
  expect(res.status).toBe(200);
  return res.body.tracks;
}

describe('GET /api/tracks', () => {
  it('lists all tracks ordered artist → album → track_no → title', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    await seed(app, sid);

    const res = await request(app).get('/api/tracks').set('Cookie', sid);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items.map((t) => t.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
    const [alpha] = res.body.items;
    expect(alpha).toEqual({
      id: expect.any(String),
      title: 'Alpha',
      artist: 'Artist A',
      album: 'Album One',
      trackNo: expect.any(Number),
      // Synthetic MP3s have no Xing header, so music-metadata reports no duration.
      duration: null,
      favorite: false,
      coverUrl: `/api/tracks/${alpha.id}/cover`,
    });
  });

  it('searches by q across title/artist/album, case-insensitively', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    await seed(app, sid);

    const byTitle = await request(app).get('/api/tracks?q=lPhA').set('Cookie', sid);
    expect(byTitle.body.total).toBe(1);
    expect(byTitle.body.items[0].title).toBe('Alpha');

    const byArtist = await request(app).get('/api/tracks?q=artist b').set('Cookie', sid);
    expect(byArtist.body.total).toBe(1);
    expect(byArtist.body.items[0].artist).toBe('Artist B');

    const byAlbum = await request(app).get('/api/tracks?q=album one').set('Cookie', sid);
    expect(byAlbum.body.total).toBe(2);
  });

  it('filters by exact artist and album', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    await seed(app, sid);

    const artist = await request(app).get('/api/tracks?artist=Artist A').set('Cookie', sid);
    expect(artist.body.total).toBe(2);

    const album = await request(app).get('/api/tracks?album=Album Two').set('Cookie', sid);
    expect(album.body.total).toBe(1);
    expect(album.body.items[0].title).toBe('Gamma');

    const none = await request(app).get('/api/tracks?artist=Nobody').set('Cookie', sid);
    expect(none.body.total).toBe(0);
    expect(none.body.items).toEqual([]);
  });

  it('filters favorites with favorite=1', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const tracks = await seed(app, sid);
    await request(app)
      .put(`/api/tracks/${tracks[2].id}/favorite`)
      .set('Cookie', sid)
      .send({ favorite: true });

    const res = await request(app).get('/api/tracks?favorite=1').set('Cookie', sid);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].title).toBe('Gamma');
    expect(res.body.items[0].favorite).toBe(true);
  });

  it('lists a playlist in playlist order', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const tracks = await seed(app, sid);
    const pl = await request(app)
      .post('/api/playlists')
      .set('Cookie', sid)
      .send({ name: 'Queue' });
    await request(app)
      .put(`/api/playlists/${pl.body.id}/tracks`)
      .set('Cookie', sid)
      .send({ trackIds: [tracks[2].id, tracks[0].id] });

    const res = await request(app)
      .get(`/api/tracks?playlistId=${pl.body.id}`)
      .set('Cookie', sid);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((t) => t.title)).toEqual(['Gamma', 'Alpha']);
  });

  it('honours limit and offset while keeping the full total', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    await seed(app, sid);

    const res = await request(app).get('/api/tracks?limit=1&offset=1').set('Cookie', sid);
    expect(res.body.total).toBe(3);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe('Beta');
  });
});

describe('GET /api/tracks/:id/stream', () => {
  it('streams the whole file with Accept-Ranges and the right Content-Type', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const tracks = await seed(app, sid);
    const wav = tracks.find((t) => t.title === 'Gamma');

    const full = await getBinary(app, `/api/tracks/${wav.id}/stream`, sid);
    expect(full.status).toBe(200);
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['content-type']).toBe('audio/wav');
    expect(full.headers['content-length']).toBe(String(full.body.length));
    expect(full.body.length).toBeGreaterThan(0);

    const mp3 = tracks.find((t) => t.title === 'Alpha');
    const mp3Res = await getBinary(app, `/api/tracks/${mp3.id}/stream`, sid);
    expect(mp3Res.headers['content-type']).toBe('audio/mpeg');
  });

  it('supports Range requests with 206 and Content-Range', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const tracks = await seed(app, sid);
    const mp3 = tracks.find((t) => t.title === 'Alpha');

    const full = await getBinary(app, `/api/tracks/${mp3.id}/stream`, sid);
    const total = full.body.length;

    const ranged = await request(app)
      .get(`/api/tracks/${mp3.id}/stream`)
      .set('Cookie', sid)
      .set('Range', 'bytes=10-19')
      .buffer(true)
      .parse(binaryParser);
    expect(ranged.status).toBe(206);
    expect(ranged.headers['content-range']).toBe(`bytes 10-19/${total}`);
    expect(ranged.headers['content-length']).toBe('10');
    expect(ranged.headers['accept-ranges']).toBe('bytes');
    expect(ranged.body.equals(full.body.subarray(10, 20))).toBe(true);

    const openEnded = await request(app)
      .get(`/api/tracks/${mp3.id}/stream`)
      .set('Cookie', sid)
      .set('Range', 'bytes=100-')
      .buffer(true)
      .parse(binaryParser);
    expect(openEnded.status).toBe(206);
    expect(openEnded.headers['content-range']).toBe(`bytes 100-${total - 1}/${total}`);
    expect(openEnded.body.length).toBe(total - 100);
  });

  it('answers 416 for an unsatisfiable range and 404 for unknown ids', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const tracks = await seed(app, sid);

    const bad = await request(app)
      .get(`/api/tracks/${tracks[0].id}/stream`)
      .set('Cookie', sid)
      .set('Range', 'bytes=999999999-');
    expect(bad.status).toBe(416);

    const missing = await request(app)
      .get('/api/tracks/00000000-0000-0000-0000-000000000000/stream')
      .set('Cookie', sid);
    expect(missing.status).toBe(404);
    expect(missing.body).toHaveProperty('error');
  });
});

describe('GET /api/tracks/:id/cover', () => {
  it('returns 404 for a track without any cover', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const res = await uploadFiles(app, sid, [
      { name: 'naked.wav', path: 'naked.wav', data: makeWav({ title: 'Naked' }) },
    ]);
    const cover = await request(app)
      .get(`/api/tracks/${res.body.tracks[0].id}/cover`)
      .set('Cookie', sid);
    expect(cover.status).toBe(404);
    expect(cover.body).toHaveProperty('error');
  });

  it('returns 404 for an unknown track id', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const cover = await request(app)
      .get('/api/tracks/00000000-0000-0000-0000-000000000000/cover')
      .set('Cookie', sid);
    expect(cover.status).toBe(404);
  });
});

describe('GET /api/library/overview', () => {
  it('reports counts plus album and artist facets', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    await seed(app, sid);

    const res = await request(app).get('/api/library/overview').set('Cookie', sid);
    expect(res.status).toBe(200);
    expect(res.body.trackCount).toBe(3);
    expect(res.body.albumCount).toBe(2);
    expect(res.body.artistCount).toBe(2);

    const albumOne = res.body.albums.find((a) => a.name === 'Album One');
    expect(albumOne).toEqual({
      name: 'Album One',
      artist: 'Artist A',
      trackCount: 2,
      coverUrl: expect.stringMatching(/^\/api\/tracks\/[0-9a-f-]{36}\/cover$/),
    });
    const albumTwo = res.body.albums.find((a) => a.name === 'Album Two');
    expect(albumTwo.coverUrl).toBeNull();

    expect(res.body.artists).toEqual([
      { name: 'Artist A', trackCount: 2 },
      { name: 'Artist B', trackCount: 1 },
    ]);
  });

  it('returns empty facets on a fresh library', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const res = await request(app).get('/api/library/overview').set('Cookie', sid);
    expect(res.body).toEqual({
      trackCount: 0,
      albumCount: 0,
      artistCount: 0,
      albums: [],
      artists: [],
    });
  });
});
