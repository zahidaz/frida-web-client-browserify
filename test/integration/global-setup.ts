import { ChildProcess } from "child_process";
import { startFridaServer, stopFridaServer } from "./setup.js";

let serverProc: ChildProcess;

export async function setup() {
    serverProc = await startFridaServer();
}

export async function teardown() {
    if (serverProc) stopFridaServer(serverProc);
}
