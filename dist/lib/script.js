import { AgentMessageKind, } from "./protocol";
import { Signal, SignalAdapter, } from "./signals";
import { EventEmitter } from "events";
import { inspect } from "util";
export class Script {
    _controller;
    destroyed;
    message;
    _events = new EventEmitter();
    _id;
    _state = "created";
    _exportsProxy;
    _logHandlerImpl = log;
    constructor(_controller, id) {
        this._controller = _controller;
        this._id = id;
        const services = new ScriptServices(this, this._events);
        const rpcController = services;
        this._exportsProxy = makeScriptExportsProxy(rpcController);
        const source = services;
        this.destroyed = new Signal(source, "destroyed");
        this.message = new Signal(source, "message");
    }
    get isDestroyed() {
        return this._state === "destroyed";
    }
    get exports() {
        return this._exportsProxy;
    }
    get logHandler() {
        return this._logHandlerImpl;
    }
    set logHandler(handler) {
        this._logHandlerImpl = handler;
    }
    get defaultLogHandler() {
        return log;
    }
    load() {
        return this._controller._activeSession.LoadScript(this._id);
    }
    async unload() {
        await this._controller._activeSession.DestroyScript(this._id);
        this._destroy();
    }
    post(message, data = null) {
        const hasData = data !== null;
        const record = [
            AgentMessageKind.Script,
            this._id,
            JSON.stringify(message),
            hasData,
            hasData ? data.toJSON().data : []
        ];
        this._controller._postToAgent(record);
    }
    _destroy() {
        if (this._state === "destroyed") {
            return;
        }
        this._state = "destroyed";
        this._events.emit("destroyed");
    }
    _dispatchMessage(message, data) {
        this._events.emit("message", message, data);
    }
}
export var ScriptRuntime;
(function (ScriptRuntime) {
    ScriptRuntime["Default"] = "default";
    ScriptRuntime["QJS"] = "qjs";
    ScriptRuntime["V8"] = "v8";
})(ScriptRuntime || (ScriptRuntime = {}));
export var MessageType;
(function (MessageType) {
    MessageType["Send"] = "send";
    MessageType["Error"] = "error";
    MessageType["Log"] = "log";
})(MessageType || (MessageType = {}));
export var LogLevel;
(function (LogLevel) {
    LogLevel["Info"] = "info";
    LogLevel["Warning"] = "warning";
    LogLevel["Error"] = "error";
})(LogLevel || (LogLevel = {}));
class ScriptServices extends SignalAdapter {
    script;
    pendingRequests = {};
    nextRequestId = 1;
    constructor(script, events) {
        super(events);
        this.script = script;
        this.signalSource.addListener("destroyed", this.onDestroyed);
        this.signalSource.addListener("message", this.onMessage);
    }
    getProxy(name, userHandler) {
        if (name === "message") {
            return (message, data) => {
                if (!isInternalMessage(message)) {
                    userHandler(message, data);
                }
            };
        }
        return null;
    }
    onDestroyed = () => {
        this.signalSource.removeListener("destroyed", this.onDestroyed);
        this.signalSource.removeListener("message", this.onMessage);
    };
    onMessage = (message, data) => {
        if (message.type === MessageType.Send && isRpcSendMessage(message)) {
            const [, id, operation, ...params] = message.payload;
            this.onRpcMessage(id, operation, params, data);
        }
        else if (isLogMessage(message)) {
            const opaqueMessage = message;
            const logMessage = opaqueMessage;
            this.script.logHandler(logMessage.level, logMessage.payload);
        }
    };
    request(operation, params) {
        return new Promise((resolve, reject) => {
            const id = this.nextRequestId++;
            const complete = (error, result) => {
                this.signalSource.removeListener("destroyed", onScriptDestroyed);
                delete this.pendingRequests[id];
                if (error === null) {
                    resolve(result);
                }
                else {
                    reject(error);
                }
            };
            function onScriptDestroyed() {
                complete(new Error("Script is destroyed"));
            }
            this.pendingRequests[id] = complete;
            this.script.post(["frida:rpc", id, operation].concat(params));
            this.signalSource.addListener("destroyed", onScriptDestroyed);
            if (this.script.isDestroyed) {
                onScriptDestroyed();
            }
        });
    }
    onRpcMessage(id, operation, params, data) {
        if (operation === RpcOperation.Ok || operation === RpcOperation.Error) {
            const callback = this.pendingRequests[id];
            if (callback === undefined) {
                return;
            }
            let value = null;
            let error = null;
            if (operation === RpcOperation.Ok) {
                value = (data !== null) ? data : params[0];
            }
            else {
                const [message, name, stack, properties] = params;
                error = new Error(message);
                error.name = name;
                error.stack = stack;
                Object.assign(error, properties);
            }
            callback(error, value);
        }
    }
}
function makeScriptExportsProxy(rpcController) {
    return new Proxy({}, {
        has(target, property) {
            return !isReservedMethodName(property);
            ;
        },
        get(target, property, receiver) {
            if (property in target && typeof property === "string") {
                return target[property];
            }
            if (property === inspect.custom) {
                return inspectProxy;
            }
            if (isReservedMethodName(property)) {
                return undefined;
            }
            return (...args) => {
                return rpcController.request("call", [property, args]);
            };
        },
        set(target, property, value, receiver) {
            if (typeof property !== "string") {
                return false;
            }
            target[property] = value;
            return true;
        },
        ownKeys(target) {
            return Object.getOwnPropertyNames(target);
        },
        getOwnPropertyDescriptor(target, property) {
            if (property in target) {
                return Object.getOwnPropertyDescriptor(target, property);
            }
            if (isReservedMethodName(property)) {
                return undefined;
            }
            return {
                writable: true,
                configurable: true,
                enumerable: true
            };
        },
    });
}
function inspectProxy() {
    return "ScriptExportsProxy {}";
}
var RpcOperation;
(function (RpcOperation) {
    RpcOperation["Ok"] = "ok";
    RpcOperation["Error"] = "error";
})(RpcOperation || (RpcOperation = {}));
function isInternalMessage(message) {
    return isRpcMessage(message) || isLogMessage(message);
}
function isRpcMessage(message) {
    return message.type === MessageType.Send && isRpcSendMessage(message);
}
function isRpcSendMessage(message) {
    const payload = message.payload;
    if (!(payload instanceof Array)) {
        return false;
    }
    return payload[0] === "frida:rpc";
}
function isLogMessage(message) {
    return message.type === "log";
}
function log(level, text) {
    switch (level) {
        case LogLevel.Info:
            console.log(text);
            break;
        case LogLevel.Warning:
            console.warn(text);
            break;
        case LogLevel.Error:
            console.error(text);
            break;
    }
}
const reservedMethodNames = new Set([
    "then",
    "catch",
    "finally",
]);
function isReservedMethodName(name) {
    return reservedMethodNames.has(name.toString());
}
