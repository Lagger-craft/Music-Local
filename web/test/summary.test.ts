import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPreview } from '../src/hooks/summary.ts';

test('splits a long list into a capped preview plus the remainder', () => {
  const items = Array.from({ length: 256 }, (_, i) => `item-${i}`);
  const { preview, rest } = splitPreview(items, 5);

  assert.equal(preview.length, 5);
  assert.equal(rest.length, 251);
  assert.deepEqual([...preview, ...rest], items); // nothing lost or reordered
});

test('keeps short lists whole with an empty remainder', () => {
  const { preview, rest } = splitPreview(['a', 'b'], 5);
  assert.deepEqual(preview, ['a', 'b']);
  assert.deepEqual(rest, []);
});

test('handles an empty list', () => {
  const { preview, rest } = splitPreview([], 5);
  assert.deepEqual(preview, []);
  assert.deepEqual(rest, []);
});

test('a cap of zero previews nothing but keeps every item in the remainder', () => {
  const { preview, rest } = splitPreview(['a', 'b'], 0);
  assert.deepEqual(preview, []);
  assert.deepEqual(rest, ['a', 'b']);
});
