# Changelog

All notable changes to `@seedess/hls-p2p` are documented here. This project
follows [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-11-15

Initial release of the peer-assisted hls.js adapter.

- `attach(hls, options)` — installs the fragment loader on an existing hls.js
  instance; call before `loadSource()`.
- `createPlayer(video, src, options)` — creates an hls.js player already wired
  to the mesh.
- `SegmentMesh` — transport-only WebRTC data-channel mesh with HTTP fallback,
  chunked framing, request hedging, and SHA-256/size verification.
- `Signaling` — WebSocket client for the Seedess swarm protocol.
- `createLoaderClass(mesh, options)` — the hls.js `fLoader` adapter.
- Stats surface (`p2pBytes`, `httpBytes`, `segmentsP2P`, `segmentsHttp`,
  `hashFailures`, `unverified`, `fallbacks`, `peers`, `connectedPeers`).

Known limits: one mesh per player instance, no cross-level ABR coordination, no
peer discovery outside the signaling room, WebRTC data channels only (iOS Safari
still uses the origin).
