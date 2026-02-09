import { describe, it, expect, vi } from "vitest";
import { Signal, SignalAdapter, SignalSource, SignalHandler } from "../../lib/signals.js";

function createMockSource(): SignalSource & { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> } {
    return {
        addListener: vi.fn(),
        removeListener: vi.fn(),
    };
}

describe("Signal", () => {
    it("connect adds listener to source", () => {
        const source = createMockSource();
        const signal = new Signal<() => void>(source, "test-event");
        const handler = vi.fn();

        signal.connect(handler);

        expect(source.addListener).toHaveBeenCalledWith("test-event", handler);
    });

    it("disconnect removes listener from source", () => {
        const source = createMockSource();
        const signal = new Signal<() => void>(source, "test-event");
        const handler = vi.fn();

        signal.disconnect(handler);

        expect(source.removeListener).toHaveBeenCalledWith("test-event", handler);
    });

    it("supports multiple connect/disconnect cycles", () => {
        const source = createMockSource();
        const signal = new Signal<() => void>(source, "ev");
        const h1 = vi.fn();
        const h2 = vi.fn();

        signal.connect(h1);
        signal.connect(h2);
        signal.disconnect(h1);

        expect(source.addListener).toHaveBeenCalledTimes(2);
        expect(source.removeListener).toHaveBeenCalledTimes(1);
        expect(source.removeListener).toHaveBeenCalledWith("ev", h1);
    });
});

describe("SignalAdapter", () => {
    it("proxies addListener to underlying source when getProxy returns null", () => {
        const source = createMockSource();
        const adapter = new SignalAdapter(source);
        const handler = vi.fn();

        adapter.addListener("ev", handler);

        expect(source.addListener).toHaveBeenCalledWith("ev", handler);
    });

    it("proxies removeListener to underlying source", () => {
        const source = createMockSource();
        const adapter = new SignalAdapter(source);
        const handler = vi.fn();

        adapter.removeListener("ev", handler);

        expect(source.removeListener).toHaveBeenCalledWith("ev", handler);
    });

    it("uses proxy handler when getProxy returns one", () => {
        const source = createMockSource();
        const proxyHandler = vi.fn();

        class TestAdapter extends SignalAdapter {
            protected getProxy(_name: string, _userHandler: SignalHandler): SignalHandler | null {
                return proxyHandler;
            }
        }

        const adapter = new TestAdapter(source);
        const handler = vi.fn();

        adapter.addListener("ev", handler);

        expect(source.addListener).toHaveBeenCalledWith("ev", proxyHandler);
        expect(source.addListener).not.toHaveBeenCalledWith("ev", handler);
    });

    it("removes proxy handler on removeListener", () => {
        const source = createMockSource();
        const proxyHandler = vi.fn();

        class TestAdapter extends SignalAdapter {
            protected getProxy(_name: string, _userHandler: SignalHandler): SignalHandler | null {
                return proxyHandler;
            }
        }

        const adapter = new TestAdapter(source);
        const handler = vi.fn();

        adapter.addListener("ev", handler);
        adapter.removeListener("ev", handler);

        expect(source.removeListener).toHaveBeenCalledWith("ev", proxyHandler);
    });

    it("stores separate proxy per handler", () => {
        const source = createMockSource();
        let callCount = 0;

        class TestAdapter extends SignalAdapter {
            protected getProxy(_name: string, _userHandler: SignalHandler): SignalHandler | null {
                callCount++;
                return vi.fn();
            }
        }

        const adapter = new TestAdapter(source);
        const h1 = vi.fn();
        const h2 = vi.fn();

        adapter.addListener("ev", h1);
        adapter.addListener("ev", h2);

        expect(callCount).toBe(2);
        const proxy1 = source.addListener.mock.calls[0][1];
        const proxy2 = source.addListener.mock.calls[1][1];
        expect(proxy1).not.toBe(proxy2);
    });
});
