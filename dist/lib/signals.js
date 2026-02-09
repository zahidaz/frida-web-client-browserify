export class Signal {
    source;
    name;
    constructor(source, name) {
        this.source = source;
        this.name = name;
    }
    connect(handler) {
        this.source.addListener(this.name, handler);
    }
    disconnect(handler) {
        this.source.removeListener(this.name, handler);
    }
}
export class SignalAdapter {
    signalSource;
    proxyHandlers = new Map();
    constructor(signalSource) {
        this.signalSource = signalSource;
    }
    addListener(name, handler) {
        const proxyHandler = this.getProxy(name, handler);
        if (proxyHandler !== null) {
            this.proxyHandlers.set(handler, proxyHandler);
            this.signalSource.addListener(name, proxyHandler);
        }
        else {
            this.signalSource.addListener(name, handler);
        }
    }
    removeListener(name, handler) {
        const proxyHandler = this.proxyHandlers.get(handler);
        this.signalSource.removeListener(name, (proxyHandler !== undefined) ? proxyHandler : handler);
    }
    getProxy(name, userHandler) {
        return null;
    }
}
