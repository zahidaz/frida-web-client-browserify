import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            "#frida-web": path.resolve(__dirname, "dist/index.js"),
        },
    },
    test: {
        testTimeout: 30000,
        hookTimeout: 30000,
        globalSetup: "./test/integration/global-setup.ts",
        fileParallelism: false,
    },
});
