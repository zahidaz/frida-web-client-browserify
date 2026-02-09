import * as esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dbusNextRoot = path.resolve(projectRoot, "../node-dbus-next");

const sharedOptions = {
    bundle: true,
    platform: "browser",
    target: "es2020",
    alias: {
        "stream": "stream-browserify",
        "util": path.resolve(__dirname, "util-shim.js"),
    },
    plugins: [{
        name: "util-slash",
        setup(build) {
            build.onResolve({ filter: /^util\/$/ }, () => ({
                path: path.resolve(__dirname, "util-shim.js"),
            }));
        },
    }],
    inject: [path.resolve(dbusNextRoot, "lib/shims/globals.js")],
    define: {
        "global": "globalThis",
    },
};

await esbuild.build({
    ...sharedOptions,
    entryPoints: [path.resolve(projectRoot, "dist/index.js")],
    outfile: path.resolve(__dirname, "dist/frida-web.js"),
    format: "esm",
});

console.log("Built app/dist/frida-web.js");

await esbuild.build({
    ...sharedOptions,
    entryPoints: [path.resolve(__dirname, "app.js")],
    outfile: path.resolve(__dirname, "dist/app.bundle.js"),
    format: "iife",
});

console.log("Built app/dist/app.bundle.js");
