import * as esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const dbusNextRoot = path.dirname(require.resolve("dbus-next/package.json"));

await esbuild.build({
    entryPoints: [path.resolve(projectRoot, "dist/index.js")],
    outfile: path.resolve(projectRoot, "dist/frida-web-client.browser.js"),
    bundle: true,
    platform: "browser",
    target: "es2020",
    format: "iife",
    globalName: "FridaWeb",
    alias: {
        "stream": "stream-browserify",
        "util": path.resolve(__dirname, "util-shim.js"),
    },
    plugins: [{
        name: "node-shims",
        setup(build) {
            build.onResolve({ filter: /^util\/$/ }, () => ({
                path: path.resolve(__dirname, "util-shim.js"),
            }));
            build.onResolve({ filter: /^timers$/ }, () => ({
                path: "timers",
                namespace: "shim",
            }));
            build.onLoad({ filter: /^timers$/, namespace: "shim" }, () => ({
                contents: "export var setImmediate = globalThis.setTimeout; export var clearImmediate = globalThis.clearTimeout;",
            }));
        },
    }],
    inject: [path.resolve(dbusNextRoot, "lib/shims/globals.js")],
    define: {
        "global": "globalThis",
    },
});

console.log("Built dist/frida-web-client.browser.js");
