import * as dbus from "dbus-next";

type ProxyMethod<T extends (...args: any[]) => any> = T;

export interface HostConnection {
    bus: dbus.MessageBus;
    session: HostSession;
}

export interface HostSession extends dbus.ClientInterface {
    EnumerateProcesses: ProxyMethod<(options: VariantDict) => Promise<HostProcessInfo[]>>;
    Attach: ProxyMethod<(pid: number, options: VariantDict) => Promise<AgentSessionId>>;
    Reattach: ProxyMethod<(id: AgentSessionId) => Promise<void>>;
}

export interface AgentSession extends dbus.ClientInterface {
    Close: ProxyMethod<() => Promise<void>>;

    Resume: ProxyMethod<(rxBatchId: number) => Promise<number>>;

    CreateScript: ProxyMethod<(source: string, options: VariantDict) => Promise<AgentScriptId>>;
    DestroyScript: ProxyMethod<(scriptId: AgentScriptId) => Promise<void>>;
    LoadScript: ProxyMethod<(scriptId: AgentScriptId) => Promise<void>>;
    PostMessages: ProxyMethod<(messages: AgentMessageRecord[], batchId: number) => Promise<void>>;

    OfferPeerConnection: ProxyMethod<(offerSdp: string, options: VariantDict) => Promise<string>>;
    AddCandidates: ProxyMethod<(candidateSdps: string[]) => Promise<void>>;
    NotifyCandidateGatheringDone: ProxyMethod<() => Promise<void>>;
    BeginMigration: ProxyMethod<() => Promise<void>>;
    CommitMigration: ProxyMethod<() => Promise<void>>;
}

export type HostProcessInfo = [pid: number, name: string, parameters: VariantDict];

export type CrashInfo = [pid: number, processName: string, summary: string, report: string, parameters: VariantDict];

export type AgentSessionId = [handle: string];

export type AgentScriptId = [handle: number];

export class AgentMessageSink extends dbus.interface.Interface {
    #handler: AgentMessageHandler;

    constructor(handler: AgentMessageHandler) {
        super("re.frida.AgentMessageSink17");

        this.#handler = handler;
    }

    @dbus.interface.method({ inSignature: "a(i(u)sbay)u" })
    PostMessages(messages: AgentMessageRecord[], batchId: number): void {
        this.#handler(messages, batchId);
    }
}

export type AgentMessageHandler = (messages: AgentMessageRecord[], batchId: number) => void;

export type AgentMessageRecord = [kind: number, scriptId: AgentScriptId, text: string, hasData: boolean, data: number[]];

export enum AgentMessageKind {
    Script = 1,
    Debugger
}

export interface VariantDict {
    [name: string]: dbus.Variant;
}
