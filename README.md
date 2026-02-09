# frida-web-client-browserify | [LIVE APP](https://zahidaz.github.io/frida_web/)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/zahidaz/frida-web-client-browserify/blob/main/LICENSE.md)

Browser-compatible client library for communicating with [frida-server](https://frida.re/) over WebSocket.

Fork of [@frida/web-client](https://github.com/frida/frida-web-client) with [dbus-next-browserify](https://github.com/zahidaz/dbus-next-browserify) replacing `@frida/dbus` for full browser compatibility.

---

## Browser Usage (CDN)

Load the pre-built browser bundle via jsDelivr:

```html
<script src="https://cdn.jsdelivr.net/gh/zahidaz/frida-web-client-browserify@main/dist/frida-web-client.browser.js"></script>
<script>
  const { Client, TransportLayerSecurity } = FridaWeb;

  const client = new Client("127.0.0.1:27042", { tls: TransportLayerSecurity.Disabled });
  const processes = await client.enumerateProcesses();
</script>
```

The bundle exposes a `FridaWeb` global with all exports.

---

## Node.js / Bundler Usage

```bash
npm install github:zahidaz/frida-web-client-browserify
```

```typescript
import { Client } from "frida-web-client-browserify";

const client = new Client("127.0.0.1:27042");
const processes = await client.enumerateProcesses();

const session = await client.attach(targetPid);
const script = await session.createScript(`
  send("Hello from Frida!");
  rpc.exports = {
    add(a, b) { return a + b; }
  };
`);

script.message.connect((message, data) => {
  console.log("Message:", message);
});

await script.load();
const result = await script.exports.add(2, 3);

await script.unload();
session.detach();
```

---

## API Reference

### Client

#### `new Client(host, options?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `host` | `string` | Server address, e.g. `"127.0.0.1:27042"` |
| `options.tls` | `"auto" \| "enabled" \| "disabled"` | TLS mode |
| `options.token` | `string` | Authentication token |

#### `client.enumerateProcesses(options?)`

Returns `Promise<Process[]>`. Each process has `pid`, `name`, and `parameters`.

| Option | Type | Description |
|--------|------|-------------|
| `pids` | `number[]` | Filter by specific PIDs |
| `scope` | `"minimal" \| "metadata" \| "full"` | Detail level |

#### `client.attach(pid, options?)`

Attaches to a process. Returns `Promise<Session>`.

| Option | Type | Description |
|--------|------|-------------|
| `realm` | `"native" \| "emulated"` | Execution realm |
| `persistTimeout` | `number` | Seconds to keep session alive after disconnect |

### Session

| Member | Description |
|--------|-------------|
| `session.pid` | Process ID |
| `session.isDetached` | Whether the session has been detached |
| `session.detached` | Signal: `session.detached.connect((reason, crash) => {})` |
| `session.detach()` | Detach from the process |
| `session.createScript(source, options?)` | Create a script. Options: `name`, `runtime` (`"default"`, `"qjs"`, `"v8"`) |
| `session.setupPeerConnection(options?)` | Set up WebRTC peer connection |

### Script

| Member | Description |
|--------|-------------|
| `script.isDestroyed` | Whether the script has been destroyed |
| `script.message` | Signal: `script.message.connect((message, data) => {})` |
| `script.destroyed` | Signal emitted when script is destroyed |
| `script.exports` | Proxy for RPC exports: `await script.exports.myFunc()` |
| `script.logHandler` | Get/set log handler: `(level, text) => void` |
| `script.load()` | Load the script on the target |
| `script.unload()` | Unload and destroy the script |
| `script.post(message, data?)` | Send a message to the script |

---

## Development

### Setup

```bash
git clone https://github.com/zahidaz/frida-web-client-browserify.git
cd frida-web-client-browserify
npm install
```

### Build

```bash
npm run build            # Compile TypeScript to dist/
npm run build:browser    # Bundle browser IIFE to dist/frida-web-client.browser.js
```

### Tests

```bash
npm run test:unit                                           # Unit tests (no server needed)
FRIDA_SERVER_PATH=/path/to/frida-server npm run test:integration  # Integration tests
npm test                                                    # All tests
```

---

## Related Projects

| Project | Description |
|---------|-------------|
| [frida_web](https://github.com/zahidaz/frida_web) | Browser GUI using this library |
| [dbus-next-browserify](https://github.com/zahidaz/dbus-next-browserify) | D-Bus protocol library with browser support |
| [frida](https://frida.re/) | Dynamic instrumentation toolkit |
| [@frida/web-client](https://github.com/frida/frida-web-client) | Upstream project |

## License

[MIT](https://github.com/zahidaz/frida-web-client-browserify/blob/main/LICENSE.md)
