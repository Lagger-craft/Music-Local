import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATCH_MAX_BYTES,
  BATCH_MAX_FILES,
  planBatches,
  relativePath,
} from '../src/hooks/batching.ts';

/** Minimal File stand-in: planBatches only reads name, size and webkitRelativePath. */
function file(relPath: string, size = 1000): File {
  const name = relPath.split('/').pop() ?? relPath;
  return { name, size, webkitRelativePath: relPath } as unknown as File;
}

const isCover = (f: File) => /^(cover|folder|album|front)(?: - .*)?\.(jpe?g|png|webp)$/i.test(f.name);

test('splits a single oversized folder across batches', () => {
  const files = [file('Album/cover.jpg', 500_000)];
  for (let i = 0; i < 500; i += 1) files.push(file(`Album/${String(i).padStart(3, '0')}.mp3`, 5_000_000));

  const batches = planBatches(files);

  assert.ok(batches.length > 1, 'a 500-track folder must not stay in one request');
  for (const batch of batches) {
    assert.ok(batch.length <= BATCH_MAX_FILES, `batch of ${batch.length} exceeds the file budget`);
    const bytes = batch.reduce((sum, f) => sum + f.size, 0);
    if (batch.length > 1) assert.ok(bytes <= BATCH_MAX_BYTES, `batch of ${bytes} bytes exceeds the byte budget`);
  }
  // Every track is uploaded exactly once (covers may repeat).
  const tracks = batches.flat().filter((f) => !isCover(f));
  assert.equal(tracks.length, 500);
  assert.equal(new Set(tracks).size, 500);
  // The cover rides along with every chunk so the server still pairs it.
  for (const batch of batches) {
    assert.ok(batch.some((f) => f.name === 'cover.jpg'), 'every chunk must carry the folder cover');
  }
});

test('keeps small folders whole in one batch', () => {
  const files = [
    file('A/cover.jpg'),
    file('A/01.mp3'),
    file('A/02.mp3'),
    file('B/Front - art.png'),
    file('B/01.flac'),
    file('loose.mp3'),
  ];

  const batches = planBatches(files);

  assert.equal(batches.length, 1);
  assert.deepEqual(new Set(batches[0]), new Set(files));
});

test('splits by bytes and lets a single oversized file go alone, still with the cover', () => {
  const files = [
    file('Album/cover.jpg', 100_000),
    file('Album/huge.flac', BATCH_MAX_BYTES + 1),
    file('Album/next.mp3', 1000),
  ];

  const batches = planBatches(files);

  const hugeBatch = batches.find((b) => b.some((f) => f.name === 'huge.flac'));
  assert.ok(hugeBatch);
  assert.equal(hugeBatch.filter((f) => !isCover(f)).length, 1, 'oversized file travels alone');
  assert.ok(hugeBatch.some((f) => f.name === 'cover.jpg'), 'even a lone oversized file keeps the cover');
  const nextBatch = batches.find((b) => b.some((f) => f.name === 'next.mp3'));
  assert.ok(nextBatch && nextBatch !== hugeBatch);
});

test('a folder with only images is chunked, never oversized', () => {
  const files = Array.from({ length: 60 }, (_, i) => file(`Art/cover-${i}.jpg`, 900_000));

  const batches = planBatches(files);

  assert.ok(batches.length > 1);
  for (const batch of batches) {
    const bytes = batch.reduce((sum, f) => sum + f.size, 0);
    if (batch.length > 1) assert.ok(bytes <= BATCH_MAX_BYTES);
  }
  assert.equal(batches.flat().length, 60);
});

test('relativePath falls back to the bare filename', () => {
  assert.equal(relativePath(file('My Album/01 - song.mp3')), 'My Album/01 - song.mp3');
  const loose = { name: 'loose.mp3', size: 1 } as unknown as File;
  assert.equal(relativePath(loose), 'loose.mp3');
});
