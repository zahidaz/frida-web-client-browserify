import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ChildProcess } from "child_process";
import { spawnTarget, FRIDA_ADDRESS } from "./setup.js";
import { Client, TransportLayerSecurity } from "#frida-web";

describe("Client", () => {
    let targetProc: ChildProcess;

    beforeAll(() => {
        targetProc = spawnTarget();
    });

    afterAll(() => {
        if (targetProc) targetProc.kill();
    });

    describe("constructor URL logic", () => {
        it("defaults to ws:// when location is undefined", () => {
            const client = new Client(FRIDA_ADDRESS);
            expect((client as any)._serverUrl).toBe(`ws://${FRIDA_ADDRESS}/ws`);
        });

        it("uses wss:// when tls is enabled", () => {
            const client = new Client(FRIDA_ADDRESS, { tls: TransportLayerSecurity.Enabled });
            expect((client as any)._serverUrl).toBe(`wss://${FRIDA_ADDRESS}/ws`);
        });

        it("uses ws:// when tls is disabled", () => {
            const client = new Client(FRIDA_ADDRESS, { tls: TransportLayerSecurity.Disabled });
            expect((client as any)._serverUrl).toBe(`ws://${FRIDA_ADDRESS}/ws`);
        });
    });

    describe("enumerateProcesses", () => {
        it("returns an array of processes", async () => {
            const client = new Client(FRIDA_ADDRESS, { tls: TransportLayerSecurity.Disabled });
            const processes = await client.enumerateProcesses();

            expect(Array.isArray(processes)).toBe(true);
            expect(processes.length).toBeGreaterThan(0);

            const first = processes[0];
            expect(typeof first.pid).toBe("number");
            expect(typeof first.name).toBe("string");
        });

        it("finds the target process", async () => {
            const client = new Client(FRIDA_ADDRESS, { tls: TransportLayerSecurity.Disabled });
            const processes = await client.enumerateProcesses();
            const target = processes.find(p => p.pid === targetProc.pid);
            expect(target).toBeDefined();
            expect(target!.name).toBe("sleep");
        });
    });

    describe("attach", () => {
        it("returns a session for a valid PID", async () => {
            const client = new Client(FRIDA_ADDRESS, { tls: TransportLayerSecurity.Disabled });
            try {
                const session = await client.attach(targetProc.pid!);

                expect(session).toBeDefined();
                expect(session.pid).toBe(targetProc.pid);
                expect(session.isDetached).toBe(false);
                expect(typeof session.id).toBe("string");

                session.detach();
            } catch (err: any) {
                if (err.message?.includes("Unable to access process")) {
                    console.warn("Skipping: frida-server needs elevated privileges to attach");
                    return;
                }
                throw err;
            }
        });

        it("rejects for a non-existent PID", async () => {
            const client = new Client(FRIDA_ADDRESS, { tls: TransportLayerSecurity.Disabled });
            await expect(client.attach(99999999)).rejects.toThrow();
        });
    });
});
