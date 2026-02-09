import { spawn, ChildProcess } from "child_process";
import WebSocket from "ws";

if (typeof globalThis.WebSocket === "undefined") {
    (globalThis as any).WebSocket = WebSocket;
}

const FRIDA_HOST = "127.0.0.1";
const FRIDA_PORT = 27042;

export const FRIDA_ADDRESS = `${FRIDA_HOST}:${FRIDA_PORT}`;

const DEFAULT_FRIDA_SERVER_PATHS = [
    "/Users/zahid/development/frida-server-17.6.2-macos-arm64/frida-server",
];

function getFridaServerPath(): string {
    if (process.env.FRIDA_SERVER_PATH) {
        return process.env.FRIDA_SERVER_PATH;
    }
    for (const p of DEFAULT_FRIDA_SERVER_PATHS) {
        try {
            const fs = require("fs");
            fs.accessSync(p, fs.constants.X_OK);
            return p;
        } catch {}
    }
    return "frida-server";
}

export async function startFridaServer(): Promise<ChildProcess> {
    const serverPath = getFridaServerPath();
    const proc = spawn(serverPath, [`--listen=${FRIDA_HOST}:${FRIDA_PORT}`], {
        stdio: "pipe",
    });

    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("frida-server startup timeout")), 15000);

        proc.on("error", (err) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to start frida-server at ${serverPath}: ${err.message}`));
        });

        proc.on("exit", (code) => {
            if (code !== null) {
                clearTimeout(timeout);
                reject(new Error(`frida-server exited with code ${code}`));
            }
        });

        const checkReady = () => {
            const conn = new WebSocket(`ws://${FRIDA_HOST}:${FRIDA_PORT}/ws`);
            conn.on("open", () => {
                conn.close();
                clearTimeout(timeout);
                resolve();
            });
            conn.on("error", () => {
                try { conn.close(); } catch {}
                setTimeout(checkReady, 300);
            });
        };

        setTimeout(checkReady, 500);
    });

    return proc;
}

export function stopFridaServer(proc: ChildProcess): void {
    proc.kill("SIGTERM");
}

export function spawnTarget(): ChildProcess {
    return spawn("sleep", ["999"], { stdio: "pipe" });
}
