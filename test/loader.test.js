import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { href: 'https://example.com/player/' };

const { createLoaderClass } = await import('../src/loader.js');
const { SegmentMesh } = await import('@seedess/core');

function fakeMesh() {
  const seen = [];
  return {
    seen,
    verifyBytes: async () => true,
    getSegment: async (seq, meta) => {
      seen.push({ seq, meta });
      return new Uint8Array([1, 2, 3]).buffer;
    },
  };
}

function load(Loader, url, frag = { sn: 7 }) {
  return new Promise((resolve) => {
    const loader = new Loader({});
    loader.load({ url, frag }, {}, {
      onSuccess: (value) => resolve({ ok: true, value }),
      onError: (error) => resolve({ ok: false, error }),
    });
  });
}

test('parses h and size from a fragment URL', async () => {
  const mesh = fakeMesh();
  const Loader = createLoaderClass(mesh);
  const hash = 'a'.repeat(64);
  const result = await load(
    Loader,
    `https://example.com/segments/7.m4s?h=${hash}&size=2048`
  );

  assert.equal(result.ok, true);
  assert.equal(mesh.seen.length, 1);
  assert.equal(mesh.seen[0].seq, 7);
  assert.equal(mesh.seen[0].meta.sha256, hash);
  assert.equal(mesh.seen[0].meta.size, 2048);
  assert.equal(mesh.seen[0].meta.url.includes('segments/7.m4s'), true);
});

test('derives the sequence from the URL when frag.sn is absent', async () => {
  const mesh = fakeMesh();
  const Loader = createLoaderClass(mesh);
  const result = await load(Loader, 'https://example.com/seg-00042.ts', {});

  assert.equal(result.ok, true);
  assert.equal(mesh.seen[0].seq, 42);
});

test('rejects a fragment URL with no sequence', async () => {
  const mesh = fakeMesh();
  const Loader = createLoaderClass(mesh);
  const result = await load(Loader, 'https://example.com/media.ts', {});

  assert.equal(result.ok, false);
  assert.match(result.error.text, /Cannot determine segment sequence/);
});

test('verifyBytes checks size and hash, and counts unhashed segments', async () => {
  const mesh = new SegmentMesh({
    signaling: { connect() {}, send() {}, close() {} },
    peerId: 'p',
  });

  const bytes = new TextEncoder().encode('hello').buffer;
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  )
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  assert.equal(await mesh.verifyBytes(bytes, { size: 5, sha256: hash }), true);
  assert.equal(await mesh.verifyBytes(bytes, { size: 6, sha256: hash }), false);
  assert.equal(await mesh.verifyBytes(bytes, { size: 5, sha256: '0'.repeat(64) }), false);
  assert.equal(await mesh.verifyBytes(bytes, { size: 5 }), true);
  assert.equal(mesh.stats.unverified, 1);
});
