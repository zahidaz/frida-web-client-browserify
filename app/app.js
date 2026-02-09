import { Client, TransportLayerSecurity, SessionDetachReason } from "./dist/frida-web.js";

const TEMPLATES = {
    hello: `send("Hello from Frida!");`,
    modules: `Process.enumerateModules().forEach(m => {
  send({ name: m.name, base: m.base.toString(), size: m.size });
});`,
    exports: `const target = Process.enumerateModules()[0];
send("Exports for " + target.name + ":");
target.enumerateExports().slice(0, 50).forEach(e => {
  send({ type: e.type, name: e.name, address: e.address.toString() });
});`,
    "classes-ios": `if (ObjC.available) {
  const classes = ObjC.classes;
  const names = Object.keys(classes).slice(0, 100);
  send({ count: Object.keys(classes).length, sample: names });
} else {
  send("ObjC runtime not available");
}`,
    "classes-android": `Java.perform(() => {
  Java.enumerateLoadedClasses({
    onMatch(name) { send(name); },
    onComplete() { send("--- done ---"); }
  });
});`,
    "hook-func": `// Replace "libfoo.so" and "target_func" with real values
const addr = Module.findExportByName("libfoo.so", "target_func");
if (addr) {
  Interceptor.attach(addr, {
    onEnter(args) {
      send("target_func called, arg0: " + args[0]);
    },
    onLeave(retval) {
      send("target_func returned: " + retval);
    }
  });
  send("Hooked target_func at " + addr);
} else {
  send("Function not found");
}`,
    "hook-objc": `if (ObjC.available) {
  const className = "NSURLSession";
  const methodName = "- dataTaskWithRequest:completionHandler:";
  const hook = ObjC.classes[className][methodName];
  Interceptor.attach(hook.implementation, {
    onEnter(args) {
      const req = new ObjC.Object(args[2]);
      send({
        method: req.HTTPMethod().toString(),
        url: req.URL().absoluteString().toString()
      });
    }
  });
  send("Hooked " + className + " " + methodName);
} else {
  send("ObjC runtime not available");
}`,
    "hook-java": `Java.perform(() => {
  const Activity = Java.use("android.app.Activity");
  Activity.onCreate.overload("android.os.Bundle").implementation = function(bundle) {
    send("Activity.onCreate: " + this.getClass().getName());
    this.onCreate(bundle);
  };
  send("Hooked Activity.onCreate");
});`,
    intercept: `// Intercept open() calls
const openPtr = Module.findExportByName(null, "open");
Interceptor.attach(openPtr, {
  onEnter(args) {
    this.path = args[0].readUtf8String();
  },
  onLeave(retval) {
    send({ syscall: "open", path: this.path, fd: retval.toInt32() });
  }
});
send("Intercepting open() calls...");`,
    stalker: `const mainThread = Process.enumerateThreads()[0];
Stalker.follow(mainThread.id, {
  events: { call: true },
  onCallSummary(summary) {
    const entries = Object.entries(summary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    send({ topCalls: entries.map(([addr, count]) => {
      const mod = Process.findModuleByAddress(ptr(addr));
      return { address: addr, count, module: mod ? mod.name : "unknown" };
    })});
    Stalker.unfollow(mainThread.id);
  }
});
send("Stalker tracing thread " + mainThread.id + "...");`,
    "memory-scan": `// Scan for a string in the first module
const mod = Process.enumerateModules()[0];
const pattern = "48 65 6c 6c 6f"; // "Hello" in hex
Memory.scan(mod.base, mod.size, pattern, {
  onMatch(address, size) {
    send({ found: address.toString(), preview: address.readUtf8String(32) });
  },
  onComplete() {
    send("Scan complete");
  }
});
send("Scanning " + mod.name + " for pattern...");`,
    rpc: `rpc.exports = {
  add(a, b) { return a + b; },
  getModules() {
    return Process.enumerateModules().map(m => ({
      name: m.name, base: m.base.toString(), size: m.size
    }));
  },
  readMemory(addr, size) {
    return ptr(addr).readByteArray(size);
  }
};`
};

const DETACH_REASONS = {
    [SessionDetachReason.ApplicationRequested]: "application requested",
    [SessionDetachReason.ProcessReplaced]: "process replaced",
    [SessionDetachReason.ProcessTerminated]: "process terminated",
    [SessionDetachReason.ConnectionTerminated]: "connection terminated",
    [SessionDetachReason.DeviceLost]: "device lost",
};

let client = null;
let currentSession = null;
let currentScript = null;
let allProcesses = [];
let attachedPid = null;
let sortField = "pid";
let sortAsc = true;
let consoleLineCount = 0;
let busy = false;

const $ = (id) => document.getElementById(id);

const serverUrlInput = $("server-url");
const authTokenInput = $("auth-token");
const tlsSelect = $("tls-select");
const connectBtn = $("connect-btn");
const disconnectBtn = $("disconnect-btn");
const statusDot = $("status-dot");
const statusText = $("status-text");
const processFilter = $("process-filter");
const processCount = $("process-count");
const processEmpty = $("process-empty");
const processTable = $("process-table");
const processTbody = $("process-tbody");
const refreshBtn = $("refresh-btn");
const runScriptBtn = $("run-script-btn");
const unloadScriptBtn = $("unload-script-btn");
const detachBtn = $("detach-btn");
const templateSelect = $("template-select");
const sessionInfo = $("session-info");
const scriptEditor = $("script-editor");
const consoleOutput = $("console-output");
const consoleEmpty = $("console-empty");
const consoleCount = $("console-count");
const clearConsoleBtn = $("clear-console-btn");
const exportConsoleBtn = $("export-console-btn");
const codeshareUrl = $("codeshare-url");
const codeshareLoadBtn = $("codeshare-load-btn");

function parseCodeShareUrl(input) {
    input = input.trim();
    const patterns = [
        /codeshare\.frida\.re\/@([^/]+)\/([^/]+)/,
        /^@([^/]+)\/([^/]+)$/,
        /^([^/]+)\/([^/]+)$/,
    ];
    for (const p of patterns) {
        const m = input.match(p);
        if (m) return { user: m[1], slug: m[2].replace(/\/$/, "") };
    }
    return null;
}

async function loadCodeShare() {
    const parsed = parseCodeShareUrl(codeshareUrl.value);
    if (!parsed) {
        appendToConsole("Invalid CodeShare URL. Use: @user/script-name or full URL", "error");
        return;
    }

    const { user, slug } = parsed;
    const apiUrl = `https://codeshare.frida.re/api/project/${user}/${slug}`;
    appendToConsole(`Loading CodeShare script: @${user}/${slug}...`, "system");
    codeshareLoadBtn.classList.add("loading");

    try {
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.source) throw new Error("No source code in response");
        scriptEditor.value = data.source;
        appendToConsole(`Loaded "${data.project_name}" by @${user}`, "system");
        codeshareUrl.value = "";
    } catch (err) {
        if (err.message === "Failed to fetch" || err.name === "TypeError") {
            appendToConsole(`CORS blocked. Open directly: https://codeshare.frida.re/@${user}/${slug}/`, "warning");
        } else {
            appendToConsole(`CodeShare load failed: ${err.message}`, "error");
        }
    } finally {
        codeshareLoadBtn.classList.remove("loading");
    }
}

function loadSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem("frida-web-settings") || "{}");
        if (saved.serverUrl) serverUrlInput.value = saved.serverUrl;
        if (saved.tls) tlsSelect.value = saved.tls;
        if (saved.token) authTokenInput.value = saved.token;
    } catch {}
}

function saveSettings() {
    try {
        localStorage.setItem("frida-web-settings", JSON.stringify({
            serverUrl: serverUrlInput.value.trim(),
            tls: tlsSelect.value,
            token: authTokenInput.value.trim(),
        }));
    } catch {}
}

function setConnected(connected) {
    statusDot.classList.toggle("connected", connected);
    statusText.textContent = connected ? "Connected" : "Disconnected";
    connectBtn.disabled = connected;
    disconnectBtn.disabled = !connected;
    refreshBtn.disabled = !connected;
    serverUrlInput.disabled = connected;
    authTokenInput.disabled = connected;
    tlsSelect.disabled = connected;
}

function setSessionActive(active, pid) {
    runScriptBtn.disabled = !active;
    detachBtn.disabled = !active;
    attachedPid = active ? pid : null;
    sessionInfo.textContent = active ? `PID ${pid}` : "";
    highlightAttachedRow();
}

function setScriptActive(active) {
    unloadScriptBtn.disabled = !active;
    runScriptBtn.disabled = !currentSession || currentSession.isDetached;
}

function highlightAttachedRow() {
    processTbody.querySelectorAll("tr.attached").forEach(r => r.classList.remove("attached"));
    if (attachedPid !== null) {
        processTbody.querySelectorAll("tr").forEach(r => {
            if (r.dataset.pid === String(attachedPid)) r.classList.add("attached");
        });
    }
}

function appendToConsole(text, level = "info") {
    consoleEmpty.classList.add("hidden");
    const line = document.createElement("div");
    line.className = `console-line ${level}`;
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
    const stamp = document.createElement("span");
    stamp.className = "timestamp";
    stamp.textContent = ts;
    line.appendChild(stamp);
    line.appendChild(document.createTextNode(text));
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
    consoleLineCount++;
    consoleCount.textContent = `(${consoleLineCount})`;
}

function sortProcesses(processes) {
    return [...processes].sort((a, b) => {
        let cmp;
        if (sortField === "pid") {
            cmp = a.pid - b.pid;
        } else {
            cmp = a.name.localeCompare(b.name);
        }
        return sortAsc ? cmp : -cmp;
    });
}

function updateSortArrows() {
    document.querySelectorAll(".sort-arrow").forEach(el => {
        el.className = "sort-arrow";
    });
    const th = document.querySelector(`th[data-sort="${sortField}"] .sort-arrow`);
    if (th) th.classList.add(sortAsc ? "asc" : "desc");
}

function renderProcesses(processes) {
    const sorted = sortProcesses(processes);
    processTbody.innerHTML = "";
    processEmpty.classList.add("hidden");
    processTable.classList.remove("hidden");
    processCount.textContent = sorted.length;

    const frag = document.createDocumentFragment();
    for (const proc of sorted) {
        const tr = document.createElement("tr");
        tr.dataset.pid = proc.pid;
        if (proc.pid === attachedPid) tr.classList.add("attached");

        const pidTd = document.createElement("td");
        pidTd.className = "pid-col";
        pidTd.textContent = proc.pid;

        const nameTd = document.createElement("td");
        nameTd.textContent = proc.name;

        const actionTd = document.createElement("td");
        actionTd.className = "action-col";
        const btn = document.createElement("button");
        btn.textContent = "Attach";
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            attachToProcess(proc.pid, proc.name);
        });
        actionTd.appendChild(btn);

        tr.appendChild(pidTd);
        tr.appendChild(nameTd);
        tr.appendChild(actionTd);

        tr.addEventListener("click", () => attachToProcess(proc.pid, proc.name));
        frag.appendChild(tr);
    }
    processTbody.appendChild(frag);
    updateSortArrows();
}

function getFilteredProcesses() {
    const q = processFilter.value.trim().toLowerCase();
    if (!q) return allProcesses;
    return allProcesses.filter(p =>
        p.name.toLowerCase().includes(q) || String(p.pid).includes(q)
    );
}

function withLoading(btn, fn) {
    if (busy) return;
    busy = true;
    btn.classList.add("loading");
    return fn().finally(() => {
        btn.classList.remove("loading");
        busy = false;
    });
}

async function connect() {
    const host = serverUrlInput.value.trim();
    if (!host) return;

    saveSettings();
    appendToConsole(`Connecting to ${host}...`, "system");

    await withLoading(connectBtn, async () => {
        try {
            const tlsMap = { disabled: TransportLayerSecurity.Disabled, enabled: TransportLayerSecurity.Enabled, auto: "auto" };
            const opts = { tls: tlsMap[tlsSelect.value] || TransportLayerSecurity.Disabled };
            const token = authTokenInput.value.trim();
            if (token) opts.token = token;
            client = new Client(host, opts);

            const processes = await client.enumerateProcesses();
            allProcesses = processes;

            setConnected(true);
            renderProcesses(allProcesses);
            appendToConsole(`Connected. ${processes.length} processes found.`, "system");
        } catch (err) {
            appendToConsole(`Connection failed: ${err.message}`, "error");
            client = null;
        }
    });
}

async function disconnect() {
    if (currentScript) {
        try { await currentScript.unload(); } catch {}
        currentScript = null;
    }
    if (currentSession && !currentSession.isDetached) {
        currentSession.detach();
    }
    currentSession = null;
    client = null;
    allProcesses = [];

    processTbody.innerHTML = "";
    processTable.classList.add("hidden");
    processEmpty.classList.remove("hidden");
    processEmpty.textContent = "Connect to a server to list processes";
    processCount.textContent = "0";

    setConnected(false);
    setSessionActive(false);
    setScriptActive(false);
    appendToConsole("Disconnected.", "system");
}

async function refreshProcesses() {
    if (!client) return;

    await withLoading(refreshBtn, async () => {
        try {
            const processes = await client.enumerateProcesses();
            allProcesses = processes;
            renderProcesses(getFilteredProcesses());
            appendToConsole(`Refreshed. ${processes.length} processes.`, "system");
        } catch (err) {
            appendToConsole(`Refresh failed: ${err.message}`, "error");
        }
    });
}

async function attachToProcess(pid, name) {
    if (busy) return;

    if (currentScript) {
        try { await currentScript.unload(); } catch {}
        currentScript = null;
        setScriptActive(false);
    }
    if (currentSession && !currentSession.isDetached) {
        currentSession.detach();
    }

    appendToConsole(`Attaching to ${name} (PID ${pid})...`, "system");

    try {
        currentSession = await client.attach(pid);
        currentSession.detached.connect((reason) => {
            appendToConsole(`Session detached: ${DETACH_REASONS[reason] || reason}`, "warning");
            setSessionActive(false);
            setScriptActive(false);
            currentSession = null;
            currentScript = null;
        });

        setSessionActive(true, pid);
        appendToConsole(`Attached to ${name} (PID ${pid})`, "system");
    } catch (err) {
        appendToConsole(`Attach failed: ${err.message}`, "error");
    }
}

async function runScript() {
    if (!currentSession || currentSession.isDetached) {
        appendToConsole("No active session. Attach to a process first.", "error");
        return;
    }

    if (currentScript) {
        try { await currentScript.unload(); } catch {}
        currentScript = null;
    }

    const source = scriptEditor.value;
    if (!source.trim()) {
        appendToConsole("Script is empty.", "warning");
        return;
    }

    await withLoading(runScriptBtn, async () => {
        try {
            currentScript = await currentSession.createScript(source);

            currentScript.message.connect((message) => {
                if (message.type === "send") {
                    const payload = typeof message.payload === "string"
                        ? message.payload
                        : JSON.stringify(message.payload, null, 2);
                    appendToConsole(payload, "info");
                } else if (message.type === "error") {
                    let text = message.description || "Unknown error";
                    if (message.stack) text += "\n" + message.stack;
                    appendToConsole(text, "error");
                }
            });

            currentScript.logHandler = (level, text) => {
                const levelMap = { error: "error", warning: "warning" };
                appendToConsole(`[${level}] ${text}`, levelMap[level] || "info");
            };

            currentScript.destroyed.connect(() => {
                setScriptActive(false);
                currentScript = null;
            });

            await currentScript.load();
            setScriptActive(true);
            appendToConsole("Script loaded.", "system");
        } catch (err) {
            appendToConsole(`Script error: ${err.message}`, "error");
            currentScript = null;
        }
    });
}

async function unloadScript() {
    if (!currentScript) return;
    try {
        await currentScript.unload();
        appendToConsole("Script unloaded.", "system");
    } catch (err) {
        appendToConsole(`Unload failed: ${err.message}`, "error");
    }
    currentScript = null;
    setScriptActive(false);
}

async function detachSession() {
    if (currentScript) {
        try { await currentScript.unload(); } catch {}
        currentScript = null;
        setScriptActive(false);
    }
    if (currentSession && !currentSession.isDetached) {
        currentSession.detach();
        appendToConsole("Detached from session.", "system");
    }
    currentSession = null;
    setSessionActive(false);
}

function clearConsole() {
    consoleOutput.innerHTML = "";
    consoleOutput.appendChild(consoleEmpty);
    consoleEmpty.classList.remove("hidden");
    consoleLineCount = 0;
    consoleCount.textContent = "";
}

function exportConsole() {
    const lines = [];
    consoleOutput.querySelectorAll(".console-line").forEach(el => {
        lines.push(el.textContent);
    });
    if (lines.length === 0) return;

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `frida-console-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    appendToConsole(`Exported ${lines.length} lines.`, "system");
}

function loadTemplate(name) {
    if (!name || !TEMPLATES[name]) return;
    scriptEditor.value = TEMPLATES[name];
    templateSelect.value = "";
}

connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
refreshBtn.addEventListener("click", refreshProcesses);
runScriptBtn.addEventListener("click", runScript);
unloadScriptBtn.addEventListener("click", unloadScript);
detachBtn.addEventListener("click", detachSession);
clearConsoleBtn.addEventListener("click", clearConsole);
exportConsoleBtn.addEventListener("click", exportConsole);
templateSelect.addEventListener("change", (e) => loadTemplate(e.target.value));
codeshareLoadBtn.addEventListener("click", loadCodeShare);
codeshareUrl.addEventListener("keydown", (e) => { if (e.key === "Enter") loadCodeShare(); });
processFilter.addEventListener("input", () => renderProcesses(getFilteredProcesses()));

document.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
        const field = th.dataset.sort;
        if (sortField === field) {
            sortAsc = !sortAsc;
        } else {
            sortField = field;
            sortAsc = true;
        }
        renderProcesses(getFilteredProcesses());
    });
});

serverUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !connectBtn.disabled) connect();
});

authTokenInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !connectBtn.disabled) connect();
});

scriptEditor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
        e.preventDefault();
        const start = scriptEditor.selectionStart;
        const end = scriptEditor.selectionEnd;
        scriptEditor.value = scriptEditor.value.substring(0, start) + "  " + scriptEditor.value.substring(end);
        scriptEditor.selectionStart = scriptEditor.selectionEnd = start + 2;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!runScriptBtn.disabled) runScript();
    }
});

document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "K") {
        e.preventDefault();
        clearConsole();
    }
});

loadSettings();
