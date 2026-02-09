import { Application } from "./application";
import { Process } from "./process";
import { HostConnection, AgentSession, AgentSessionId } from "./protocol";
import { Session } from "./session";
export declare class Client {
    private readonly _serverUrl;
    private readonly _token;
    private _hostConnectionRequest;
    private readonly _sessions;
    constructor(host: string, options?: ClientOptions);
    enumerateProcesses(options?: ProcessQueryOptions): Promise<Process[]>;
    enumerateApplications(options?: ApplicationQueryOptions): Promise<Application[]>;
    querySystemParameters(): Promise<SystemParameters>;
    spawn(program: string, options?: SpawnOptions): Promise<number>;
    resume(pid: number): Promise<void>;
    kill(pid: number): Promise<void>;
    attach(pid: number, options?: SessionOptions): Promise<Session>;
    _getHostConnection(): Promise<HostConnection>;
    private _doGetHostConnection;
    _linkAgentSession(id: AgentSessionId, connection: HostConnection): Promise<AgentSession>;
    private _onAgentSessionDetached;
}
export interface ClientOptions {
    tls?: TransportLayerSecurity;
    token?: string;
}
export declare enum TransportLayerSecurity {
    Auto = "auto",
    Disabled = "disabled",
    Enabled = "enabled"
}
export interface ProcessQueryOptions {
    pids?: number[];
    scope?: Scope;
}
export declare enum Scope {
    Minimal = "minimal",
    Metadata = "metadata",
    Full = "full"
}
export interface SessionOptions {
    realm?: Realm;
    persistTimeout?: number;
}
export declare enum Realm {
    Native = "native",
    Emulated = "emulated"
}
export interface ApplicationQueryOptions {
    identifiers?: string[];
    scope?: Scope;
}
export interface SystemParameters {
    [key: string]: any;
}
export interface SpawnOptions {
    argv?: string[];
    envp?: {
        [key: string]: string;
    };
    env?: {
        [key: string]: string;
    };
    cwd?: string;
    stdio?: "inherit" | "pipe";
}
