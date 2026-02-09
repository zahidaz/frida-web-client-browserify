/// <reference types="node" />
import { HostConnection, AgentSession, AgentSessionId, AgentMessageRecord } from "./protocol";
import { Crash } from "./crash";
import { Script, ScriptOptions } from "./script";
import { Signal } from "./signals";
import { EventEmitter } from "events";
export declare class Session {
    private _controller;
    pid: number;
    id: string;
    persistTimeout: number;
    detached: Signal<SessionDetachedHandler>;
    _events: EventEmitter<[never]>;
    _activeSession: AgentSession;
    private _obsoleteSession;
    private _state;
    private readonly _sink;
    private _lastRxBatchId;
    private _pendingMessages;
    private _nextSerial;
    private _pendingDeliveries;
    private readonly _scripts;
    private _peerConnection;
    private _peerOptions;
    constructor(_controller: SessionController, session: AgentSession, pid: number, id: string, persistTimeout: number, connection: HostConnection);
    get isDetached(): boolean;
    detach(): void;
    resume(): Promise<void>;
    createScript(source: string, options?: ScriptOptions): Promise<Script>;
    setupPeerConnection(options?: PeerOptions): Promise<void>;
    private _handlePeerConnectionClosure;
    private _dispatchMessages;
    _postToAgent(record: AgentMessageRecord): void;
    private _maybeDeliverPendingMessages;
    private _emitBatch;
    private _deliverBatch;
    _onDetached(reason: SessionDetachReason, crash: Crash | null): void;
    _destroy(reason: SessionDetachReason, crash: Crash | null): void;
    _closeSessionAndPeerConnection(reason: SessionDetachReason): Promise<void>;
    _beginMigration(newSession: AgentSession): void;
    _cancelMigration(newSession: AgentSession): void;
}
export type SessionDetachedHandler = (reason: SessionDetachReason, crash: Crash | null) => void;
export declare enum SessionDetachReason {
    ApplicationRequested = 1,
    ProcessReplaced = 2,
    ProcessTerminated = 3,
    ConnectionTerminated = 4,
    DeviceLost = 5
}
export interface PeerOptions {
    stunServer?: string;
    relays?: Relay[];
}
export interface Relay {
    address: string;
    username: string;
    password: string;
    kind: RelayKind;
}
export declare enum RelayKind {
    TurnUDP = 0,
    TurnTCP = 1,
    TurnTLS = 2
}
export interface SessionController {
    _getHostConnection(): Promise<HostConnection>;
    _linkAgentSession(id: AgentSessionId, connection: HostConnection): Promise<AgentSession>;
}
