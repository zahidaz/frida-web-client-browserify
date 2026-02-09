import { AgentMessageSink, AgentMessageKind, } from "./protocol";
import { Script } from "./script";
import { Signal } from "./signals";
import { EventEmitter } from "events";
import * as dbus from "dbus-next";
import RTCStream from "@frida/rtc-stream";
export class Session {
    _controller;
    pid;
    id;
    persistTimeout;
    detached;
    _events = new EventEmitter();
    _activeSession;
    _obsoleteSession = null;
    _state = "attached";
    _sink;
    _lastRxBatchId = 0;
    _pendingMessages = [];
    _nextSerial = 1;
    _pendingDeliveries = 0;
    _scripts = new Map();
    _peerConnection = null;
    _peerOptions = null;
    constructor(_controller, session, pid, id, persistTimeout, connection) {
        this._controller = _controller;
        this.pid = pid;
        this.id = id;
        this.persistTimeout = persistTimeout;
        this._activeSession = session;
        this._sink = new AgentMessageSink(this._dispatchMessages);
        this.detached = new Signal(this._events, "detached");
        connection.bus.export("/re/frida/AgentMessageSink/" + id, this._sink);
    }
    get isDetached() {
        return this._state !== "attached";
    }
    detach() {
        this._destroy(SessionDetachReason.ApplicationRequested, null);
    }
    async resume() {
        switch (this._state) {
            case "attached":
                return;
            case "interrupted":
                break;
            case "detached":
                throw new Error("session is gone");
        }
        const connection = await this._controller._getHostConnection();
        const rawId = [this.id];
        await connection.session.Reattach(rawId);
        const agentSession = await this._controller._linkAgentSession(rawId, connection);
        this._beginMigration(agentSession);
        if (this._peerOptions !== null) {
            await this.setupPeerConnection(this._peerOptions);
        }
        const lastTxBatchId = await this._activeSession.Resume(this._lastRxBatchId);
        if (lastTxBatchId !== 0) {
            let m;
            while ((m = this._pendingMessages[0]) !== undefined && m.deliveryAttempts > 0 && m.serial <= lastTxBatchId) {
                this._pendingMessages.shift();
            }
        }
        this._state = "attached";
        this._maybeDeliverPendingMessages();
    }
    async createScript(source, options = {}) {
        const rawOptions = {};
        const { name, runtime } = options;
        if (name !== undefined) {
            rawOptions.name = new dbus.Variant("s", name);
        }
        if (runtime !== undefined) {
            rawOptions.runtime = new dbus.Variant("s", runtime);
        }
        const scriptId = await this._activeSession.CreateScript(source, rawOptions);
        const script = new Script(this, scriptId);
        const onScriptDestroyed = () => {
            this._scripts.delete(scriptId[0]);
            script.destroyed.disconnect(onScriptDestroyed);
        };
        script.destroyed.connect(onScriptDestroyed);
        this._scripts.set(scriptId[0], script);
        return script;
    }
    async setupPeerConnection(options = {}) {
        const { stunServer, relays } = options;
        const iceServers = [];
        const rawOptions = {};
        if (stunServer !== undefined) {
            iceServers.push({ urls: makeStunUrl(stunServer) });
            rawOptions["stun-server"] = new dbus.Variant("s", stunServer);
        }
        if (relays !== undefined) {
            iceServers.push(...relays.map(({ address, username, password, kind }) => {
                return {
                    urls: makeTurnUrl(address, kind),
                    username,
                    credential: password
                };
            }));
            rawOptions["relays"] = new dbus.Variant("a(sssu)", relays.map(({ address, username, password, kind }) => [address, username, password, kind]));
        }
        const serverSession = this._activeSession;
        const peerConnection = new RTCPeerConnection({ iceServers });
        peerConnection.oniceconnectionstatechange = () => {
            if (peerConnection.iceConnectionState === "disconnected") {
                if (onError !== null) {
                    onError(new Error(("Unable to establish peer connection")));
                    onError = null;
                    onReady = null;
                }
                this._handlePeerConnectionClosure(peerConnection);
            }
        };
        const pendingLocalCandidates = new IceCandidateQueue();
        pendingLocalCandidates.on("add", (candidates) => {
            const candidateSdps = candidates
                .filter(({ candidate }) => {
                const tokens = candidate.split(" ");
                const address = tokens[4];
                return !address.endsWith(".local");
            })
                .map(c => "a=" + c.candidate);
            if (candidateSdps.length > 0) {
                serverSession.AddCandidates(candidateSdps);
            }
        });
        pendingLocalCandidates.once("done", () => {
            serverSession.NotifyCandidateGatheringDone();
        });
        const pendingRemoteCandidates = new IceCandidateQueue();
        pendingRemoteCandidates.on("add", (candidates) => {
            for (const candidate of candidates) {
                peerConnection.addIceCandidate(candidate);
            }
        });
        pendingRemoteCandidates.once("done", () => {
            peerConnection.addIceCandidate(new RTCIceCandidate({
                candidate: "",
                sdpMid: "0",
                sdpMLineIndex: 0
            }));
        });
        peerConnection.onicecandidate = e => {
            pendingLocalCandidates.add(e.candidate);
        };
        serverSession.on("NewCandidates", (sdps) => {
            for (const sdp of sdps) {
                pendingRemoteCandidates.add(new RTCIceCandidate({
                    candidate: sdp.substr(2),
                    sdpMid: "0",
                    sdpMLineIndex: 0
                }));
            }
        });
        serverSession.on("CandidateGatheringDone", () => {
            pendingRemoteCandidates.add(null);
        });
        let onReady = null;
        let onError = null;
        const ready = new Promise((resolve, reject) => {
            onReady = resolve;
            onError = reject;
        });
        const peerChannel = peerConnection.createDataChannel("session");
        peerChannel.onopen = async () => {
            let peerAgentSession = null;
            let migrating = false;
            try {
                const peerBus = dbus.peerBus(RTCStream.from(peerChannel), {
                    authMethods: [],
                });
                const peerAgentSessionObj = await peerBus.getProxyObject("re.frida.AgentSession17", "/re/frida/AgentSession");
                peerAgentSession = peerAgentSessionObj.getInterface("re.frida.AgentSession17");
                peerBus.export("/re/frida/AgentMessageSink", this._sink);
                await serverSession.BeginMigration();
                this._beginMigration(peerAgentSession);
                migrating = true;
                await serverSession.CommitMigration();
                this._peerConnection = peerConnection;
                this._peerOptions = options;
                if (onReady !== null) {
                    onReady();
                    onReady = null;
                    onError = null;
                }
            }
            catch (e) {
                if (migrating) {
                    this._cancelMigration(peerAgentSession);
                }
                if (onError !== null) {
                    onError(e);
                    onError = null;
                    onReady = null;
                }
            }
        };
        peerChannel.onerror = event => {
            if (onError !== null) {
                onError(new Error(event.message));
                onError = null;
                onReady = null;
            }
        };
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        const answerSdp = await serverSession.OfferPeerConnection(offer.sdp, rawOptions);
        const answer = new RTCSessionDescription({ type: "answer", sdp: answerSdp });
        await peerConnection.setRemoteDescription(answer);
        pendingLocalCandidates.notifySessionStarted();
        pendingRemoteCandidates.notifySessionStarted();
        await ready;
    }
    _handlePeerConnectionClosure(peerConnection) {
        if (peerConnection !== this._peerConnection) {
            return;
        }
        this._peerConnection = null;
        if (this.persistTimeout !== 0) {
            if (this._state !== "attached") {
                return;
            }
            this._state = "interrupted";
            this._activeSession = this._obsoleteSession;
            this._obsoleteSession = null;
            this._events.emit("detached", SessionDetachReason.ConnectionTerminated, null);
        }
        else {
            this._destroy(SessionDetachReason.ConnectionTerminated, null);
        }
    }
    _dispatchMessages = (messages, batchId) => {
        for (const [kind, scriptId, text, hasData, data] of messages) {
            if (kind != AgentMessageKind.Script) {
                continue;
            }
            const script = this._scripts.get(scriptId[0]);
            if (script === undefined) {
                continue;
            }
            script._dispatchMessage(JSON.parse(text), hasData ? Buffer.from(data) : null);
        }
        this._lastRxBatchId = batchId;
    };
    _postToAgent(record) {
        if (this._state === "detached") {
            return;
        }
        this._pendingMessages.push({
            serial: this._nextSerial++,
            deliveryAttempts: 0,
            record,
        });
        this._maybeDeliverPendingMessages();
    }
    _maybeDeliverPendingMessages() {
        if (this._state !== "attached") {
            return;
        }
        if (this._pendingMessages.length === 0) {
            return;
        }
        const batch = [];
        let message;
        let totalSize = 0;
        const maxSize = 4 * 1024 * 1024;
        while ((message = this._pendingMessages.shift()) !== undefined) {
            const { record } = message;
            const text = record[2];
            const data = record[4];
            const messageSizeEstimate = text.length + data.length;
            if (totalSize + messageSizeEstimate > maxSize && batch.length !== 0) {
                break;
            }
            batch.push(message);
            totalSize += messageSizeEstimate;
        }
        if (this.persistTimeout === 0) {
            this._emitBatch(batch);
        }
        else {
            this._deliverBatch(batch);
        }
    }
    _emitBatch(messages) {
        this._activeSession.PostMessages(messages.map(m => m.record), 0);
    }
    async _deliverBatch(messages) {
        let success = false;
        this._pendingDeliveries++;
        try {
            for (const message of messages) {
                message.deliveryAttempts++;
            }
            const batchId = messages[messages.length - 1].serial;
            await this._activeSession.PostMessages(messages.map(m => m.record), batchId);
            success = true;
        }
        catch (e) {
            this._pendingMessages.push(...messages);
            this._pendingMessages.sort((a, b) => a.serial - b.serial);
        }
        finally {
            this._pendingDeliveries--;
            if (this._pendingDeliveries === 0 && success) {
                this._nextSerial = 1;
            }
        }
    }
    _onDetached(reason, crash) {
        if (this.persistTimeout !== 0 && reason === SessionDetachReason.ConnectionTerminated) {
            if (this._state !== "attached") {
                return;
            }
            this._state = "interrupted";
            this._events.emit("detached", reason, null);
        }
        else {
            this._destroy(reason, crash);
        }
    }
    _destroy(reason, crash) {
        if (this._state === "detached") {
            return;
        }
        this._state = "detached";
        for (const script of this._scripts.values()) {
            script._destroy();
        }
        this._closeSessionAndPeerConnection(reason);
        this._events.emit("detached", reason, crash);
        this._events.emit("destroyed");
    }
    async _closeSessionAndPeerConnection(reason) {
        if (reason === SessionDetachReason.ApplicationRequested) {
            try {
                await this._activeSession.Close();
            }
            catch (e) {
            }
        }
        const peerConnection = this._peerConnection;
        if (peerConnection !== null) {
            this._peerConnection = null;
            peerConnection.close();
        }
    }
    _beginMigration(newSession) {
        this._obsoleteSession = this._activeSession;
        this._activeSession = newSession;
    }
    _cancelMigration(newSession) {
        this._activeSession = this._obsoleteSession;
        this._obsoleteSession = null;
    }
}
export var SessionDetachReason;
(function (SessionDetachReason) {
    SessionDetachReason[SessionDetachReason["ApplicationRequested"] = 1] = "ApplicationRequested";
    SessionDetachReason[SessionDetachReason["ProcessReplaced"] = 2] = "ProcessReplaced";
    SessionDetachReason[SessionDetachReason["ProcessTerminated"] = 3] = "ProcessTerminated";
    SessionDetachReason[SessionDetachReason["ConnectionTerminated"] = 4] = "ConnectionTerminated";
    SessionDetachReason[SessionDetachReason["DeviceLost"] = 5] = "DeviceLost";
})(SessionDetachReason || (SessionDetachReason = {}));
export var RelayKind;
(function (RelayKind) {
    RelayKind[RelayKind["TurnUDP"] = 0] = "TurnUDP";
    RelayKind[RelayKind["TurnTCP"] = 1] = "TurnTCP";
    RelayKind[RelayKind["TurnTLS"] = 2] = "TurnTLS";
})(RelayKind || (RelayKind = {}));
function makeStunUrl(address) {
    return `stun:${address}?transport=udp`;
}
function makeTurnUrl(address, kind) {
    switch (kind) {
        case RelayKind.TurnUDP:
            return `turn:${address}?transport=udp`;
        case RelayKind.TurnTCP:
            return `turn:${address}?transport=tcp`;
        case RelayKind.TurnTLS:
            return `turns:${address}?transport=tcp`;
    }
}
class IceCandidateQueue extends EventEmitter {
    sessionState = "starting";
    gatheringState = "gathering";
    pending = [];
    timer = null;
    add(candidate) {
        if (candidate !== null) {
            this.pending.push(candidate);
        }
        else {
            this.gatheringState = "gathered";
        }
        if (this.timer === null) {
            this.timer = setTimeout(this.maybeEmitCandidates, 10);
        }
    }
    notifySessionStarted() {
        this.sessionState = "started";
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.maybeEmitCandidates();
    }
    maybeEmitCandidates = () => {
        this.timer = null;
        if (this.sessionState !== "started") {
            return;
        }
        if (this.pending.length > 0) {
            this.emit("add", this.pending.splice(0));
        }
        if (this.gatheringState === "gathered") {
            this.emit("done");
            this.gatheringState = "notified";
        }
    };
}
