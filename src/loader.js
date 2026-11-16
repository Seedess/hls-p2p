/**
 * hls.js fragment loader backed by a SegmentMesh.
 *
 * hls.js still loads the playlist itself; only media fragments and the init
 * segment go through this loader. Every fragment is verified before it reaches
 * the player, and the mesh falls back to the fragment URL when no peer has it.
 */

/** hls.js uses this shape for loader stats. */
function statsFor(size) {
  const now = performance.now();
  return {
    aborted: false,
    loaded: size,
    total: size,
    retry: 0,
    chunkCount: 1,
    bwEstimate: 0,
    loading: { start: now, first: now, end: now },
    parsing: { start: now, end: now },
    buffering: { start: now, first: now, end: now },
    trequest: now,
    tfirst: now,
    tload: now,
  };
}

function defaultIsInit(context, url) {
  if (context?.frag?.sn === 'initSegment') return true;
  try {
    const path = new URL(url, location.href).pathname;
    return /(^|\/)init(\.[a-z0-9]+)?$/i.test(path);
  } catch {
    return false;
  }
}

function defaultSeq(context, url) {
  const sn = context?.frag?.sn;
  if (Number.isInteger(sn)) return sn;
  try {
    const path = new URL(url, location.href).pathname;
    const match = path.match(/seg(?:ments)?[\/-](\d+)/i) ?? path.match(/\/(\d+)\.[a-z0-9]+$/i);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export function createLoaderClass(mesh, options = {}) {
  const hashParam = options.hashParam ?? 'h';
  const sizeParam = options.sizeParam ?? 'size';
  const isInit = options.isInit ?? defaultIsInit;
  const seqFrom = options.seqFromContext ?? defaultSeq;

  function metaFromUrl(url) {
    const meta = { url };
    try {
      const parsed = new URL(url, location.href);
      const sha256 = parsed.searchParams.get(hashParam);
      const size = Number(parsed.searchParams.get(sizeParam));
      if (sha256) meta.sha256 = sha256;
      if (Number.isFinite(size) && size > 0) meta.size = size;
    } catch {
      // Leave url-only metadata; verification falls back to the verify mode.
    }
    return meta;
  }

  return class SeedessHlsLoader {
    constructor(config) {
      this.config = config;
      this.aborted = false;
      this.stats = statsFor(0);
    }

    load(context, config, callbacks) {
      if (this.aborted) return;
      const url = context.url;
      const meta = options.metaResolver?.(context, url) ?? metaFromUrl(url);

      if (isInit(context, url)) {
        fetch(url)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`${response.status} ${response.statusText}`);
            }
            return response.arrayBuffer();
          })
          .then(async (data) => {
            if (this.aborted) return;
            const ok = await mesh.verifyBytes(data, meta);
            if (!ok) throw new Error('init segment verification failed');
            this.stats = statsFor(data.byteLength);
            callbacks.onSuccess({ url, data: data.slice(0) }, this.stats, context);
          })
          .catch((error) => {
            if (this.aborted) return;
            callbacks.onError({ code: 0, text: error.message }, context);
          });
        return;
      }

      const seq = seqFrom(context, url);
      if (!Number.isInteger(seq)) {
        callbacks.onError(
          { code: 0, text: `Cannot determine segment sequence from ${url}` },
          context
        );
        return;
      }

      mesh
        .getSegment(seq, meta)
        .then((data) => {
          if (this.aborted) return;
          this.stats = statsFor(data.byteLength);
          // hls.js transfers this buffer to its worker, which would detach the
          // copy the mesh keeps for seeding. Hand it a clone instead.
          callbacks.onSuccess({ url, data: data.slice(0) }, this.stats, context);
        })
        .catch((error) => {
          if (this.aborted) return;
          callbacks.onError({ code: 0, text: error.message }, context);
        });
    }

    abort() {
      this.aborted = true;
    }

    destroy() {
      this.aborted = true;
    }
  };
}
