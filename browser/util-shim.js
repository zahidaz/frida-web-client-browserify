export function inspect(obj) {
    return JSON.stringify(obj);
}

export const custom = Symbol.for("nodejs.util.inspect.custom");
inspect.custom = custom;

export const types = {
    isPromise(obj) { return obj instanceof Promise; },
    isRegExp(obj) { return obj instanceof RegExp; },
};

export function inherits(ctor, superCtor) {
    ctor.super_ = superCtor;
    Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

export function deprecate(fn) { return fn; }
