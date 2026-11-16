# @seedess/hls-p2p

A drop-in [hls.js](https://github.com/video-dev/hls.js) plugin that turns an HLS
playback into a peer-assisted one. Peers exchange media fragments over WebRTC data
channels, verify them, and fall back to the original URL when nobody has the bytes.

No build step, no player fork, no manifest rewrite on the client.

This package is the hls.js adapter. The player-agnostic mesh, signaling client and
verification live in [`@seedess/core`](../core); the universal entry [`@seedess/p2p`](../p2p)
re-exports this adapter as `@seedess/p2p/hls`.

## Use

```html
<script src="/vendor/hls.min.js"></script>
<script type="module">
  import { createPlayer } from './lib/seedess-hls/index.js';

  const player = await createPlayer(video, 'index.m3u8', {
    room: 'my-stream',
    signalingUrl: 'api/swarm',
    configUrl: 'api/config',
  });

  player.on('stats', (stats) => {
    console.log(stats.p2pBytes, stats.httpBytes, stats.peers);
  });
</script>
```

Already have a player?

```js
import { attach } from './lib/seedess-hls/index.js';

const hls = new Hls();
const player = attach(hls, { room: 'my-stream' }); // before loadSource()
hls.loadSource(src);
hls.attachMedia(video);
```

`attach()` installs the fragment loader synchronously; config and signaling start in
the background. `createPlayer()` is the same thing plus `loadSource`/`attachMedia`.

## What it needs

1. **A signaling room.** The server must speak the swarm protocol (`welcome`,
   `peer-join`, `peer-leave`, `signal`, `have`) over a WebSocket. The Seedess proofs
   serve one at `/api/swarm` with a Durable Object.
2. **Segment metadata.** For verification, fragment URLs can carry `h` (SHA-256) and
   `size`; a Seedess proxy adds them. Without a hash the plugin still shares bytes but
   counts them as `unverified` (`verifyMode: 'auto'`). Use `verifyMode: 'sha256'` to
   refuse unhashed segments.

Playlist and init segment are still loaded normally; only media fragments go through
the mesh.

## Options

| Option | Default | Meaning |
|---|---|---|
| `room` | `?room=` or a hash of the page | Swarm room. Same stream → same room. |
| `peerId` | `?peer=` or random | Identity within the room. |
| `role` | `peer` | `seed` always reads the origin and never requests peer bytes. |
| `signalingUrl` | `api/swarm` | WebSocket endpoint, resolved against the page. |
| `configUrl` | `api/config` | JSON endpoint returning `{ iceServers }`. `false` to skip. |
| `iceServers` | STUN Cloudflare | Overrides `configUrl`. Add TURN for symmetric NAT. |
| `verifyMode` | `auto` | `sha256` (strict), `size`, or `auto` (hash if present). |
| `requestTimeout` | `30000` | Per-peer segment timeout before origin fallback. |
| `haveWaitMs` | `800` | Grace period for a peer bitfield before origin. |
| `hlsConfig` | `{}` | Passed to `new Hls()`. |
| `profile` | `false` | Console logging of per-segment routes. |

## Stats

`player.stats` and `player.on('stats', fn)` expose:

```
p2pBytes, httpBytes, segmentsP2P, segmentsHttp,
hashFailures, unverified, fallbacks, peers, connectedPeers, error
```

## Limits

- One mesh per player instance; no ABR coordination across levels yet.
- No peer discovery outside the signaling room.
- WebRTC data channels only; iOS Safari playback still uses the origin.
- The plugin trusts the signaling server for peer identity.
