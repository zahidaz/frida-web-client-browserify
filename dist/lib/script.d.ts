/// <reference types="node" />
/// <reference types="node" />
import { AgentSession, AgentScriptId, AgentMessageRecord } from "./protocol";
import { Signal } from "./signals";
import { EventEmitter } from "events";
export declare class Script {
    private _controller;
    destroyed: Signal<ScriptDestroyedHandler>;
    message: Signal<ScriptMessageHandler>;
    _events: EventEmitter<[never]>;
    private readonly _id;
    private _state;
    private readonly _exportsProxy;
    private _logHandlerImpl;
    constructor(_controller: ScriptController, id: AgentScriptId);
    get isDestroyed(): boolean;
    get exports(): ScriptExports;
    get logHandler(): ScriptLogHandler;
    set logHandler(handler: ScriptLogHandler);
    get defaultLogHandler(): ScriptLogHandler;
    load(): Promise<void>;
    unload(): Promise<void>;
    post(message: any, data?: Buffer | null): void;
    _destroy(): void;
    _dispatchMessage(message: Message, data: Buffer | null): void;
}
export interface ScriptOptions {
    name?: string;
    runtime?: ScriptRuntime;
}
export declare enum ScriptRuntime {
    Default = "default",
    QJS = "qjs",
    V8 = "v8"
}
export type ScriptDestroyedHandler = () => void;
export type ScriptMessageHandler = (message: Message, data: Buffer | null) => void;
export type ScriptLogHandler = (level: LogLevel, text: string) => void;
export type Message = SendMessage | ErrorMessage;
export declare enum MessageType {
    Send = "send",
    Error = "error",
    Log = "log"
}
export interface SendMessage {
    type: MessageType.Send;
    payload: any;
}
export interface ErrorMessage {
    type: MessageType.Error;
    description: string;
    stack?: string;
    fileName?: string;
    lineNumber?: number;
    columnNumber?: number;
}
export interface ScriptExports {
    [name: string]: (...args: any[]) => Promise<any>;
}
export declare enum LogLevel {
    Info = "info",
    Warning = "warning",
    Error = "error"
}
export interface ScriptController {
    _activeSession: AgentSession;
    _postToAgent(record: AgentMessageRecord): void;
}
