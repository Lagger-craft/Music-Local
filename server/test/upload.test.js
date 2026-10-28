import http from 'node:http';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makeJpeg, makeMp3, makeWav } from './fixtures.js';
import { getBinary, login, makeApp, uploadFiles } from './helpers.js';

describe('POST /api/library/upload', () => {
  it('stores a WAV and parses LIST INFO tags', async () => {
    const { app, dataDir } = await makeApp();
    const sid = await login(app);
    const res = await uploadFiles(app, sid, [
      { name: 'song.wav', path: 'My Album/01 - song.wav', data: makeWav({ title: 'Blue Monday', artist: 'New Order', album: 'Power, Corruption & Lies' }) },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);
    expect(res.body.skipped).toEqual([]);
    expect(res.body.errors).toEqual([]);
    expect(res.body.coversApplied).toBe(0);
    const [track] = res.body.tracks;
    expect(track.title).toBe('Blue Monday');
    expect(track.artist).toBe('New Order');
    expect(track.album).toBe('Power, Corruption & Lies');
    expect(track.duration).toBeGreaterThan(0);
    expect(track.favorite).toBe(false);
    expect(track.coverUrl).toBeNull();
    expect(track.id).toMatch(/^[0-9a-f-]{36}$/);

    // Storage layout: DATA_DIR/music/<trackId>/<originalname>
    const trackDir = path.join(dataDir, 'music', track.id);
    const files = await readdir(trackDir);
    expect(files).toEqual(['01 - song.wav']);
    const stored = await stat(path.join(trackDir, files[0]));
    expect(stored.size).toBeGreaterThan(0);
  });

  it('applies tag defaults for missing fields', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const res = await uploadFiles(app, sid, [
      { name: 'untitled.wav', path: 'untitled.wav', data: makeWav() },
    ]);
    expect(res.status).toBe(200);
    const [track] = res.body.tracks;
    expect(track.title).toBe('untitled');
    expect(track.artist).toBe('Unknown Artist');
    expect(track.album).toBe('Unknown Album');
  });

  it('extracts an embedded picture and serves it from the cover endpoint', async () => {
    const { app, dataDir } = await makeApp();
    const sid = await login(app);
    const jpeg = makeJpeg(7);
    const res = await uploadFiles(app, sid, [
      {
        name: 'cover-song.mp3',
        path: 'cover-song.mp3',
        data: makeMp3({ title: 'Ceremony', artist: 'New Order', album: 'Movement', picture: { data: jpeg } }),
      },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);
    const [track] = res.body.tracks;
    expect(track.coverUrl).toBe(`/api/tracks/${track.id}/cover`);

    const cover = await getBinary(app, track.coverUrl, sid);
    expect(cover.status).toBe(200);
    expect(cover.headers['content-type']).toMatch(/image\/jpeg/);
    expect(cover.body.equals(jpeg)).toBe(true);

    const covers = await readdir(path.join(dataDir, 'covers'));
    expect(covers).toHaveLength(1);
  });

  it('associates a folder cover with audio files lacking embedded art', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const folderJpeg = makeJpeg(1);
    const res = await uploadFiles(app, sid, [
      { name: '01 - alpha.mp3', path: 'My Album/01 - alpha.mp3', data: makeMp3() },
      { name: '02 - beta.mp3', path: 'My Album/02 - beta.mp3', data: makeMp3() },
      { name: 'Cover - front.jpg', path: 'My Album/Cover - front.jpg', data: folderJpeg },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.added).toBe(2);
    expect(res.body.coversApplied).toBe(2);
    expect(res.body.tracks[0].coverUrl).toBe(`/api/tracks/${res.body.tracks[0].id}/cover`);

    const cover = await getBinary(app, res.body.tracks[0].coverUrl, sid);
    expect(cover.status).toBe(200);
    expect(cover.body.equals(folderJpeg)).toBe(true);
  });

  it('folder-cover names are case-insensitive and allow a " - ..." suffix', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const res = await uploadFiles(app, sid, [
      { name: 'track.mp3', path: 'Disc1/track.mp3', data: makeMp3() },
      { name: 'ALBUM - disc1.PNG', path: 'Disc1/ALBUM - disc1.PNG', data: makeJpeg(3) },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.coversApplied).toBe(1);
  });

  it('prefers embedded art over a folder cover', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const embedded = makeJpeg(11);
    const folder = makeJpeg(22);
    const res = await uploadFiles(app, sid, [
      {
        name: '01 - song.mp3',
        path: 'Album/01 - song.mp3',
        data: makeMp3({ title: 'Song', artist: 'A', album: 'B', picture: { data: embedded } }),
      },
      { name: 'cover.jpg', path: 'Album/cover.jpg', data: folder },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.coversApplied).toBe(0);

    const cover = await getBinary(app, res.body.tracks[0].coverUrl, sid);
    expect(cover.status).toBe(200);
    expect(cover.body.equals(embedded)).toBe(true);
  });

  it('falls back to the basename when a paths entry is missing', async () => {
    const { app, dataDir } = await makeApp();
    const sid = await login(app);
    const res = await uploadFiles(app, sid, [
      { name: 'loose track.wav', data: makeWav({ title: 'Loose', artist: 'Solo', album: 'One' }) },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);
    const [track] = res.body.tracks;
    const files = await readdir(path.join(dataDir, 'music', track.id));
    expect(files).toEqual(['loose track.wav']);
  });

  it('skips unsupported files with a reason and errors on corrupt audio', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const res = await uploadFiles(app, sid, [
      { name: 'readme.txt', path: 'readme.txt', data: Buffer.from('hello') },
      { name: 'notes.jpg', path: 'notes.jpg', data: makeJpeg(5) }, // not a folder-cover name
      { name: 'bad.mp3', path: 'bad.mp3', data: Buffer.from('this is not audio at all') },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(0);
    expect(res.body.tracks).toEqual([]);
    const skippedNames = res.body.skipped.map((s) => s.filename).sort();
    expect(skippedNames).toEqual(['notes.jpg', 'readme.txt']);
    for (const s of res.body.skipped) expect(typeof s.reason).toBe('string');
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].filename).toBe('bad.mp3');
    expect(typeof res.body.errors[0].error).toBe('string');
  });

  it('keeps tracks from different folders separate for folder covers', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const res = await uploadFiles(app, sid, [
      { name: 'a.mp3', path: 'FolderA/a.mp3', data: makeMp3() },
      { name: 'b.mp3', path: 'FolderB/b.mp3', data: makeMp3() },
      { name: 'cover.jpg', path: 'FolderA/cover.jpg', data: makeJpeg(9) },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.coversApplied).toBe(1);
    expect(res.body.tracks[0].coverUrl).not.toBeNull(); // FolderA
    expect(res.body.tracks[1].coverUrl).toBeNull(); // FolderB has no cover
  });

  it('rejects uploads without a session cookie', async () => {
    const { app } = await makeApp();
    const { body, contentType } = await import('./fixtures.js').then((m) =>
      m.multipart([{ name: 'files', filename: 'a.wav', data: makeWav() }]),
    );
    const res = await request(app)
      .post('/api/library/upload')
      .set('Content-Type', contentType)
      .send(body);
    expect(res.status).toBe(401);
  });

  it('removes staged temp files when the client aborts mid-upload', async () => {
    const { app, dataDir } = await makeApp();
    const sid = await login(app);
    const server = app.listen(0);
    const { port } = server.address();

    const boundary = 'abortboundary';
    const header = Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="files"; filename="big.wav"\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n',
      'latin1',
    );

    // Declare a 10 MB body, deliver only 1 MB, then kill the socket: the
    // server stages a .part file it must clean up after the abort.
    await new Promise((resolve) => {
      const req = http.request({
        port,
        method: 'POST',
        path: '/api/library/upload',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': 10 * 1024 * 1024,
          Cookie: sid,
        },
      });
      req.on('error', () => {}); // ECONNRESET is the point of the test
      req.write(header);
      req.write(Buffer.alloc(1024 * 1024, 0x61));
      setTimeout(() => {
        req.destroy();
        resolve(undefined);
      }, 200);
    });

    // Give the server time to observe the abort and run its cleanup path.
    await new Promise((r) => setTimeout(r, 500));
    const leftovers = await readdir(path.join(dataDir, 'tmp')).catch(() => []);
    expect(leftovers).toEqual([]);

    await new Promise((r) => server.close(r));
  });

  it('stores the full original bytes, readable through the stream endpoint', async () => {
    const { app } = await makeApp();
    const sid = await login(app);
    const wav = makeWav({ title: 'T', artist: 'A', album: 'L' });
    const res = await uploadFiles(app, sid, [{ name: 'x.wav', path: 'x.wav', data: wav }]);
    const stream = await getBinary(app, `/api/tracks/${res.body.tracks[0].id}/stream`, sid);
    expect(stream.status).toBe(200);
    expect(stream.body.length).toBe(wav.length);
  });
});
