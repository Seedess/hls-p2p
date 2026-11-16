# Example

A single HTML page that consumes a stream with hls.js and the Seedess adapter.

1. Create a stream and copy its `pk_…` token.
2. Replace `STREAM` and `TOKEN`.
3. Serve the folder:

```bash
npx serve lib/hls-p2p/examples/basic
```

`createPlayer(video, { stream, token })` derives the master, signaling and config URLs,
installs the fragment loader, and returns the controller with `stats`.
