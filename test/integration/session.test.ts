import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChildProcess } from "child_process";
import { spawnTarget, FRIDA_ADDRESS } from "./setup.js";
import { Client, Session, TransportLayerSecurity, SessionDetachReason, MessageType } from "#frida-web";

describe("Session and Script", () => {
    let targetProc: ChildProcess;
    let client: Client;
    let session: Session;

    beforeEach(async (ctx) => {
        targetProc = spawnTarget();
        client = new Client(FRIDA_ADDRESS, { tls: TransportLayerSecurity.Disabled });
        try {
            session = await client.attach(targetProc.pid!);
        } catch (err: any) {
            if (err.message?.includes("Unable to access process")) {
                ctx.skip();
                return;
            }
            throw err;
        }
    });

    afterEach(() => {
        if (session && !session.isDetached) {
            session.detach();
        }
        if (targetProc) targetProc.kill();
    });

    it("creates and loads a script that sends a message", async () => {
        const script = await session.createScript('send("hello");');

        const messagePromise = new Promise<any>((resolve) => {
            script.message.connect((message, _data) => {
                resolve(message);
            });
        });

        await script.load();
        const message = await messagePromise;

        expect(message.type).toBe(MessageType.Send);
        expect(message.payload).toBe("hello");

        await script.unload();
        expect(script.isDestroyed).toBe(true);
    });

    it("supports RPC exports", async () => {
        const script = await session.createScript(`
            rpc.exports = {
                add(a, b) { return a + b; },
                greet(name) { return "hello " + name; }
            };
        `);

        await script.load();

        const sum = await script.exports.add(2, 3);
        expect(sum).toBe(5);

        const greeting = await script.exports.greet("world");
        expect(greeting).toBe("hello world");

        await script.unload();
    });

    it("calls logHandler for console.log", async () => {
        const script = await session.createScript('console.log("test output");');

        const logs: Array<{ level: string; text: string }> = [];
        script.logHandler = (level, text) => {
            logs.push({ level, text });
        };

        await script.load();
        await new Promise(r => setTimeout(r, 1000));

        expect(logs.length).toBeGreaterThan(0);
        expect(logs.some(l => l.text === "test output")).toBe(true);

        await script.unload();
    });

    it("receives complex objects via send", async () => {
        const script = await session.createScript('send({ key: "value", num: 42 });');

        const messagePromise = new Promise<any>((resolve) => {
            script.message.connect((message, _data) => {
                resolve(message);
            });
        });

        await script.load();
        const message = await messagePromise;

        expect(message.type).toBe(MessageType.Send);
        expect(message.payload).toEqual({ key: "value", num: 42 });

        await script.unload();
    });

    it("fires destroyed signal on unload", async () => {
        const script = await session.createScript('send("test");');
        await script.load();

        let destroyed = false;
        script.destroyed.connect(() => {
            destroyed = true;
        });

        await script.unload();
        expect(destroyed).toBe(true);
        expect(script.isDestroyed).toBe(true);
    });

    it("fires detached signal on detach", async () => {
        let detachReason: SessionDetachReason | null = null;
        session.detached.connect((reason, _crash) => {
            detachReason = reason;
        });

        session.detach();
        await new Promise(r => setTimeout(r, 500));

        expect(session.isDetached).toBe(true);
        expect(detachReason).toBe(SessionDetachReason.ApplicationRequested);
    });

    it("enumerates modules via script", async () => {
        const script = await session.createScript(`
            const modules = Process.enumerateModules();
            send(modules.slice(0, 3).map(m => m.name));
        `);

        const messagePromise = new Promise<any>((resolve) => {
            script.message.connect((message, _data) => {
                resolve(message);
            });
        });

        await script.load();
        const message = await messagePromise;

        expect(message.type).toBe(MessageType.Send);
        expect(Array.isArray(message.payload)).toBe(true);
        expect(message.payload.length).toBeGreaterThan(0);

        await script.unload();
    });
});
