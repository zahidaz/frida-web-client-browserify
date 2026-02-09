export interface SignalSource {
    addListener(name: string, handler: SignalHandler): void;
    removeListener(name: string, handler: SignalHandler): void;
}
export declare class Signal<T extends SignalHandler> {
    private source;
    private name;
    constructor(source: SignalSource, name: string);
    connect(handler: T): void;
    disconnect(handler: T): void;
}
export type SignalHandler = (...args: any[]) => void;
export declare class SignalAdapter implements SignalSource {
    protected signalSource: SignalSource;
    private proxyHandlers;
    constructor(signalSource: SignalSource);
    addListener(name: string, handler: SignalHandler): void;
    removeListener(name: string, handler: SignalHandler): void;
    protected getProxy(name: string, userHandler: SignalHandler): SignalHandler | null;
}
