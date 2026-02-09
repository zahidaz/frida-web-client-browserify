import { Session, SessionDetachReason, } from "./session";
import * as dbus from "dbus-next";
export class Client {
    _serverUrl;
    _token = null;
    _hostConnectionRequest = null;
    _sessions = new Map();
    constructor(host, options = {}) {
        let scheme;
        const { tls = "auto" } = options;
        switch (tls) {
            case "auto":
                scheme = (typeof location !== "undefined" && location.protocol === "https:") ? "wss" : "ws";
                break;
            case "enabled":
                scheme = "wss";
                break;
            case "disabled":
                scheme = "ws";
                break;
        }
        this._serverUrl = `${scheme}://${host}/ws`;
        if (options.token !== undefined) {
            this._token = options.token;
        }
    }
    async enumerateProcesses(options = {}) {
        const connection = await this._getHostConnection();
        const rawOptions = {};
        const { pids, scope } = options;
        if (pids !== undefined) {
            rawOptions.pids = new dbus.Variant("au", pids);
        }
        if (scope !== undefined) {
            rawOptions.scope = new dbus.Variant("s", scope);
        }
        const rawProcesses = await connection.session.EnumerateProcesses(rawOptions);
        return rawProcesses.map(([pid, name, parameters]) => {
            return { pid, name, parameters };
        });
    }
    async attach(pid, options = {}) {
        const connection = await this._getHostConnection();
        const rawOptions = {};
        const { realm, persistTimeout } = options;
        if (realm !== undefined) {
            rawOptions.realm = new dbus.Variant("s", realm);
        }
        if (persistTimeout !== undefined) {
            rawOptions["persist-timeout"] = new dbus.Variant("u", persistTimeout);
        }
        const sessionId = await connection.session.Attach(pid, rawOptions);
        const agentSession = await this._linkAgentSession(sessionId, connection);
        const session = new Session(this, agentSession, pid, sessionId[0], persistTimeout ?? 0, connection);
        this._sessions.set(session.id, session);
        session._events.once("destroyed", () => {
            this._sessions.delete(session.id);
        });
        return session;
    }
    async _getHostConnection() {
        if (this._hostConnectionRequest === null) {
            this._hostConnectionRequest = this._doGetHostConnection();
        }
        return this._hostConnectionRequest;
    }
    async _doGetHostConnection() {
        const bus = dbus.connect(this._serverUrl, { noAuth: true, peer: true });
        bus.once("error", () => { });
        await new Promise((resolve, reject) => {
            bus.once("connect", resolve);
            bus.once("error", reject);
        });
        bus._connection.stream.once("close", () => {
            this._hostConnectionRequest = null;
            for (const session of this._sessions.values()) {
                session._onDetached(SessionDetachReason.ConnectionTerminated, null);
            }
        });
        if (this._token !== null) {
            const authServiceObj = await bus.getProxyObject("re.frida.AuthenticationService17", "/re/frida/AuthenticationService");
            const authService = authServiceObj.getInterface("re.frida.AuthenticationService17");
            await authService.Authenticate(this._token);
        }
        const sessionObj = await bus.getProxyObject("re.frida.HostSession17", "/re/frida/HostSession");
        const session = sessionObj.getInterface("re.frida.HostSession17");
        session.on("AgentSessionDetached", this._onAgentSessionDetached);
        return { bus, session };
    }
    async _linkAgentSession(id, connection) {
        const agentSessionObj = await connection.bus.getProxyObject("re.frida.AgentSession17", "/re/frida/AgentSession/" + id[0]);
        return agentSessionObj.getInterface("re.frida.AgentSession17");
    }
    _onAgentSessionDetached = (id, reason, rawCrash) => {
        const session = this._sessions.get(id[0]);
        if (session === undefined) {
            return;
        }
        const [pid, processName, summary, report, parameters] = rawCrash;
        const crash = (pid !== 0)
            ? { pid, processName, summary, report, parameters }
            : null;
        session._onDetached(reason, crash);
    };
}
export var TransportLayerSecurity;
(function (TransportLayerSecurity) {
    TransportLayerSecurity["Auto"] = "auto";
    TransportLayerSecurity["Disabled"] = "disabled";
    TransportLayerSecurity["Enabled"] = "enabled";
})(TransportLayerSecurity || (TransportLayerSecurity = {}));
export var Scope;
(function (Scope) {
    Scope["Minimal"] = "minimal";
    Scope["Metadata"] = "metadata";
    Scope["Full"] = "full";
})(Scope || (Scope = {}));
export var Realm;
(function (Realm) {
    Realm["Native"] = "native";
    Realm["Emulated"] = "emulated";
})(Realm || (Realm = {}));
