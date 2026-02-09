# Frida Web Client

A TypeScript client library and web app for communicating with [frida-server](https://frida.re/) over WebSocket. Works in both Node.js and the browser.

Fork of [@frida/web-client](https://github.com/frida/frida-web-client) with [dbus-next](https://github.com/zahidaz/node-dbus-next) replacing `@frida/dbus` for full browser compatibility.

## Web App

A ready-to-use browser GUI for pentesters. Connect to any frida-server, browse processes, attach, and run scripts — no install required.

**Open `app/index.html` directly in your browser** (no HTTP server needed).

### Features

- Connect to any frida-server URL with TLS on/off/auto
- Browse and filter processes, sortable by PID or name
- 12 built-in script templates: hook native/ObjC/Java functions, Interceptor, Stalker trace, memory scan, enumerate modules/exports/classes, RPC exports
- Live console with timestamped output, export to `.txt`
- Keyboard shortcuts: `Enter` connect, `Ctrl+Enter` run script, `Ctrl+Shift+K` clear console
- Settings persisted to localStorage
- Loading spinners, busy guards, auto-unload on re-run

### Building the App

```bash
npm install
npm run build
npm run build:browser
```

Then open `app/index.html` or deploy the `app/` directory to any static host.

### Running frida-server

```bash
frida-server --listen=0.0.0.0:27042
```

## Library Usage

### Installation

```
npm install @frida/web-client
```

### Quick Start

```typescript
import { Client } from "@frida/web-client";

const client = new Client("127.0.0.1:27042", { tls: "disabled" });

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

## API Reference

### Client

#### `new Client(host, options?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `host` | `string` | Server address, e.g. `"127.0.0.1:27042"` |
| `options.tls` | `"auto" \| "enabled" \| "disabled"` | TLS mode. Default: `"auto"` (uses page protocol) |
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
| `session.id` | Session identifier |
| `session.isDetached` | Whether the session has been detached |
| `session.detached` | Signal: `session.detached.connect((reason, crash) => {})` |
| `session.detach()` | Detach from the process |
| `session.resume()` | Resume an interrupted session |
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

## Development

### Prerequisites

- Node.js 18+
- frida-server binary (for integration tests)

### Setup

```bash
git clone https://github.com/zahidaz/frida_web.git
cd frida_web
npm install
npm run build
```

### Tests

```bash
npm run test:unit
npm run test:integration
npm test
```

Integration tests require frida-server. Set `FRIDA_SERVER_PATH` if it's not in the default location:

```bash
FRIDA_SERVER_PATH=/path/to/frida-server npm run test:integration
```

## License

MIT
