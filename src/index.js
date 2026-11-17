import { SegmentMesh, Signaling, DEFAULT_ICE } from '@seedess/core';
import { createLoaderClass } from './loader.js';

export { SegmentMesh, Signaling } from '@seedess/core';
export { createLoaderClass };

function randomId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function hashKey(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function param(name) {
  try {
    return new URLSearchParams(location.search).get(name);
  } catch {
    return null;
  }
}

async function resolveConfig(options) {
  let iceServers = options.iceServers ?? null;
  let offloadCap = options.offloadCap ?? null;
  let meteredDefault = options.meteredDefault ?? false;

  if (options.configUrl !== false) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const response = await fetch(options.configUrl ?? 'api/config', {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      clearTimeout(timer);
      if (response.ok) {
        const body = await response.json();
        const server = body?.data ?? body ?? {};
        if (!iceServers && Array.isArray(server.iceServers)) iceServers = server.iceServers;
        if (options.offloadCap == null && server.offloadCap != null) offloadCap = server.offloadCap;
        if (options.meteredDefault == null && server.meteredDefault != null) {
          meteredDefault = server.meteredDefault;
        }
      }
    } catch {
      // Keep the explicit defaults; ICE falls back to STUN-only.
    }
  }

  return { iceServers: iceServers ?? DEFAULT_ICE, offloadCap, meteredDefault };
}

/**
 * Controller returned by attach()/createPlayer().
 *
 * `stats` mirrors the mesh counters. `on('stats', fn)` subscribes; the listener
 * also receives peer counts. All state is per instance, so several players can
 * live on one page.
 */
const DEFAULT_ORIGIN = 'https://seedess.com';

function originFor(options) {
  return (options.origin ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
}

/** Accept { stream, token } and derive the three URLs; explicit URLs win. */
function withDerivedUrls(options = {}) {
  const stream = options.stream ?? options.room;
  const token = options.token;
  if (!stream || !token) return options;
  const origin = originFor(options);
  return {
    ...options,
    room: stream,
    signalingUrl:
      options.signalingUrl ??
      `${origin}/signaling/room/${encodeURIComponent(stream)}?token=${encodeURIComponent(token)}`,
    configUrl:
      options.configUrl ?? `${origin}/signaling/config?token=${encodeURIComponent(token)}`,
  };
}

function derivedMaster(options = {}) {
  const stream = options.stream ?? options.room;
  const token = options.token;
  if (!stream || !token) return null;
  return `${originFor(options)}/play/${encodeURIComponent(stream)}/master.m3u8?token=${encodeURIComponent(
    token,
  )}`;
}

class Controller {
  constructor(rawOptions = {}) {
    const options = withDerivedUrls(rawOptions);
    this.options = options;
    this.role = options.role ?? 'peer';
    this.room =
      options.room ??
      options.stream ??
      param('room') ??
      `seedess-${hashKey(String(options.streamId ?? options.src ?? location.pathname))}`;
    this.peerId = options.peerId ?? param('peer') ?? randomId('peer');
    this.listeners = new Set();
    this.stats = {
      p2pBytes: 0,
      httpBytes: 0,
      segmentsP2P: 0,
      segmentsHttp: 0,
      hashFailures: 0,
      unverified: 0,
      fallbacks: 0,
      peers: 0,
      connectedPeers: 0,
      error: null,
    };

    const signaling = new Signaling({
      url: options.signalingUrl ?? 'api/swarm',
      room: this.room,
      peerId: this.peerId,
      role: this.role,
    });

    this.mesh = new SegmentMesh({
      signaling,
      peerId: this.peerId,
      role: this.role,
      onStats: (stats) => this.publish(stats),
      onPeers: (peers) => {
        const connected = peers.filter((peer) => peer.connected).length;
        this.publish({ ...this.stats, peers: peers.length, connectedPeers: connected });
      },
      requestTimeout: options.requestTimeout,
      haveWaitMs: options.haveWaitMs,
      hedgeDelay: options.hedgeDelay,
      verifyMode: options.verifyMode ?? 'auto',
      profile: options.profile ?? false,
      offloadCap: options.offloadCap ?? null,
      meteredDefault: options.meteredDefault ?? false,
    });

    this.Loader = createLoaderClass(this.mesh, options);
    this.ready = this.init();
  }

  async init() {
    const config = await resolveConfig(this.options);
    this.mesh.iceServers = config.iceServers;
    this.mesh.offloadCap = config.offloadCap;
    this.mesh.meteredDefault = config.meteredDefault;
    this.mesh.start();
  }

  publish(stats) {
    this.stats = stats;
    for (const listener of this.listeners) {
      try {
        listener(stats);
      } catch {
        // A listener must not break the mesh.
      }
    }
  }

  on(event, listener) {
    if (event !== 'stats') return () => {};
    this.listeners.add(listener);
    listener(this.stats);
    return () => this.listeners.delete(listener);
  }

  waitForPeers(timeout) {
    return this.mesh.waitForPeers(timeout);
  }

  waitForOpenPeer(timeout) {
    return this.mesh.waitForOpenPeer(timeout);
  }

  waitForHave(seq, timeout) {
    return this.mesh.waitForHave(seq, timeout);
  }

  destroy() {
    this.listeners.clear();
    this.mesh.stop();
    this.hls?.destroy();
  }
}

/**
 * Turn an existing hls.js instance into a peer-assisted one.
 *
 *   const hls = new Hls();
 *   Seedess.attach(hls, { room: 'my-stream' });
 *   hls.loadSource(src);
 *   hls.attachMedia(video);
 *
 * The fragment loader is installed synchronously, so call attach() before
 * loadSource(). Config and signaling start in the background.
 */
export function attach(hls, options = {}) {
  const controller = new Controller(options);
  hls.config.fLoader = controller.Loader;
  controller.hls = hls;
  return controller;
}

/**
 * Create an hls.js player already wired to the mesh.
 *
 *   const player = await Seedess.createPlayer(video, src, { room: 'demo' });
 *   player.on('stats', console.log);
 */
export async function createPlayer(video, src, options = {}) {
  if (src && typeof src === 'object') {
    options = src;
    src = undefined;
  }
  const Hls = options.Hls ?? globalThis.Hls;
  if (!Hls) throw new Error('Seedess: hls.js is not loaded');

  const source = src ?? derivedMaster(options);
  if (!source) {
    throw new Error('Seedess: pass a manifest URL or { stream, token }');
  }

  const controller = new Controller({ ...options, src: source });
  const hls = new Hls({ fLoader: controller.Loader, ...(options.hlsConfig ?? {}) });
  controller.hls = hls;

  await controller.ready;
  hls.loadSource(source);
  hls.attachMedia(video);
  return controller;
}
