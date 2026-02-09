# @frida/web-client

Client library for communicating with a remote Frida server (frida-server, frida-portal, etc.) over WebSocket. Works in both Node.js and the browser.

## Installation

```
npm install @frida/web-client
```

## Quick Start

```typescript
import { Client } from "@frida/web-client";

const client = new Client("127.0.0.1:27042", { tls: "disabled" });

// List running processes
const processes = await client.enumerateProcesses();
console.log("Processes:", processes);

// Attach to a process
const session = await client.attach(targetPid);

// Create and load a script
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

// Call RPC exports
const result = await script.exports.add(2, 3);
console.log("RPC result:", result);

// Clean up
await script.unload();
session.detach();
```

## API

### Client

#### `new Client(host, options?)`

Creates a new client connection to a Frida server.

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
| `session.detached` | Signal. Connect with `session.detached.connect((reason, crash) => {})` |
| `session.detach()` | Detach from the process |
| `session.resume()` | Resume an interrupted session |
| `session.createScript(source, options?)` | Create a script. Options: `name`, `runtime` (`"default"`, `"qjs"`, `"v8"`) |
| `session.setupPeerConnection(options?)` | Set up WebRTC peer connection |

### Script

| Member | Description |
|--------|-------------|
| `script.isDestroyed` | Whether the script has been destroyed |
| `script.message` | Signal. Connect with `script.message.connect((message, data) => {})` |
| `script.destroyed` | Signal emitted when script is destroyed |
| `script.exports` | Proxy for RPC-exported functions, e.g. `await script.exports.myFunc()` |
| `script.logHandler` | Get/set log handler: `(level, text) => void` |
| `script.load()` | Load the script on the target |
| `script.unload()` | Unload and destroy the script |
| `script.post(message, data?)` | Send a message to the script |

## Web App

A browser-based GUI is included in the `app/` directory. It lets you connect to a frida-server, browse processes, attach, and run scripts interactively.

### Building

```bash
npm run build            # Compile TypeScript
npm run build:browser    # Bundle for browser
```

Then serve the `app/` directory with any static file server:

```bash
npx serve app
```

Or open `app/index.html` directly if your frida-server is running locally.

### Running frida-server

```bash
frida-server --listen=127.0.0.1:27042
```

## Development

### Prerequisites

- Node.js 18+
- frida-server binary (for integration tests)

### Setup

```bash
git clone <repo-url>
cd frida-web-client
npm install
npm run build
```

### Running Tests

Unit tests (no server needed):

```bash
npm run test:unit
```

Integration tests (requires frida-server):

```bash
FRIDA_SERVER_PATH=/path/to/frida-server npm run test:integration
```

All tests:

```bash
npm test
```

## License

MIT
