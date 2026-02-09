import { Client, TransportLayerSecurity, SessionDetachReason } from "./dist/frida-web.js";

let client = null;
let currentSession = null;
let currentScript = null;
let allProcesses = [];

const serverUrlInput = document.getElementById("server-url");
const authTokenInput = document.getElementById("auth-token");
const connectBtn = document.getElementById("connect-btn");
const disconnectBtn = document.getElementById("disconnect-btn");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const processFilter = document.getElementById("process-filter");
const processCount = document.getElementById("process-count");
const processEmpty = document.getElementById("process-empty");
const processTable = document.getElementById("process-table");
const processTbody = document.getElementById("process-tbody");
const refreshBtn = document.getElementById("refresh-btn");
const runScriptBtn = document.getElementById("run-script-btn");
const unloadScriptBtn = document.getElementById("unload-script-btn");
const detachBtn = document.getElementById("detach-btn");
const sessionInfo = document.getElementById("session-info");
const scriptEditor = document.getElementById("script-editor");
const consoleOutput = document.getElementById("console-output");
const consoleEmpty = document.getElementById("console-empty");
const clearConsoleBtn = document.getElementById("clear-console-btn");

function setConnected(connected) {
    statusDot.classList.toggle("connected", connected);
    statusText.textContent = connected ? "Connected" : "Disconnected";
    connectBtn.disabled = connected;
    disconnectBtn.disabled = !connected;
    refreshBtn.disabled = !connected;
    serverUrlInput.disabled = connected;
    authTokenInput.disabled = connected;
}

function setSessionActive(active, pid) {
    runScriptBtn.disabled = !active;
    detachBtn.disabled = !active;
    sessionInfo.textContent = active ? `PID: ${pid}` : "";
}

function setScriptActive(active) {
    unloadScriptBtn.disabled = !active;
    runScriptBtn.disabled = active;
}

function appendToConsole(text, level = "info") {
    consoleEmpty.classList.add("hidden");
    const line = document.createElement("div");
    line.className = `console-line ${level}`;
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const stamp = document.createElement("span");
    stamp.className = "timestamp";
    stamp.textContent = ts;
    line.appendChild(stamp);
    line.appendChild(document.createTextNode(text));
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function renderProcesses(processes) {
    processTbody.innerHTML = "";
    processEmpty.classList.add("hidden");
    processTable.classList.remove("hidden");
    processCount.textContent = processes.length;

    for (const proc of processes) {
        const tr = document.createElement("tr");

        const pidTd = document.createElement("td");
        pidTd.className = "pid-col";
        pidTd.textContent = proc.pid;

        const nameTd = document.createElement("td");
        nameTd.textContent = proc.name;

        const actionTd = document.createElement("td");
        actionTd.className = "action-col";
        const btn = document.createElement("button");
        btn.textContent = "Attach";
        btn.addEventListener("click", () => attachToProcess(proc.pid, proc.name));
        actionTd.appendChild(btn);

        tr.appendChild(pidTd);
        tr.appendChild(nameTd);
        tr.appendChild(actionTd);
        processTbody.appendChild(tr);
    }
}

function filterProcesses(query) {
    const q = query.toLowerCase();
    const filtered = allProcesses.filter(p =>
        p.name.toLowerCase().includes(q) || String(p.pid).includes(q)
    );
    renderProcesses(filtered);
}

async function connect() {
    const host = serverUrlInput.value.trim();
    if (!host) return;

    const token = authTokenInput.value.trim() || undefined;
    connectBtn.disabled = true;
    appendToConsole(`Connecting to ${host}...`, "system");

    try {
        const opts = { tls: TransportLayerSecurity.Disabled };
        if (token) opts.token = token;
        client = new Client(host, opts);

        const processes = await client.enumerateProcesses();
        allProcesses = processes.sort((a, b) => a.pid - b.pid);

        setConnected(true);
        renderProcesses(allProcesses);
        appendToConsole(`Connected. ${processes.length} processes found.`, "system");
    } catch (err) {
        appendToConsole(`Connection failed: ${err.message}`, "error");
        client = null;
        connectBtn.disabled = false;
    }
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
    try {
        const processes = await client.enumerateProcesses();
        allProcesses = processes.sort((a, b) => a.pid - b.pid);
        const query = processFilter.value.trim();
        if (query) {
            filterProcesses(query);
        } else {
            renderProcesses(allProcesses);
        }
        appendToConsole(`Refreshed. ${processes.length} processes.`, "system");
    } catch (err) {
        appendToConsole(`Refresh failed: ${err.message}`, "error");
    }
}

async function attachToProcess(pid, name) {
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
        currentSession.detached.connect((reason, crash) => {
            const reasons = {
                [SessionDetachReason.ApplicationRequested]: "application requested",
                [SessionDetachReason.ProcessReplaced]: "process replaced",
                [SessionDetachReason.ProcessTerminated]: "process terminated",
                [SessionDetachReason.ConnectionTerminated]: "connection terminated",
                [SessionDetachReason.DeviceLost]: "device lost",
            };
            appendToConsole(`Session detached: ${reasons[reason] || reason}`, "warning");
            setSessionActive(false);
            setScriptActive(false);
            currentSession = null;
            currentScript = null;
        });

        setSessionActive(true, pid);
        appendToConsole(`Attached to ${name} (PID ${pid}), session: ${currentSession.id}`, "system");
    } catch (err) {
        appendToConsole(`Attach failed: ${err.message}`, "error");
    }
}

async function runScript() {
    if (!currentSession || currentSession.isDetached) {
        appendToConsole("No active session.", "error");
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

    appendToConsole("Creating script...", "system");

    try {
        currentScript = await currentSession.createScript(source);

        currentScript.message.connect((message, data) => {
            if (message.type === "send") {
                const payload = typeof message.payload === "string"
                    ? message.payload
                    : JSON.stringify(message.payload, null, 2);
                appendToConsole(payload, "info");
            } else if (message.type === "error") {
                let text = message.description;
                if (message.stack) text += "\n" + message.stack;
                appendToConsole(text, "error");
            }
        });

        currentScript.logHandler = (level, text) => {
            appendToConsole(`[${level}] ${text}`, level === "error" ? "error" : level === "warning" ? "warning" : "info");
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
}

connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
refreshBtn.addEventListener("click", refreshProcesses);
runScriptBtn.addEventListener("click", runScript);
unloadScriptBtn.addEventListener("click", unloadScript);
detachBtn.addEventListener("click", detachSession);
clearConsoleBtn.addEventListener("click", clearConsole);
processFilter.addEventListener("input", (e) => filterProcesses(e.target.value));

scriptEditor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
        e.preventDefault();
        const start = scriptEditor.selectionStart;
        const end = scriptEditor.selectionEnd;
        scriptEditor.value = scriptEditor.value.substring(0, start) + "  " + scriptEditor.value.substring(end);
        scriptEditor.selectionStart = scriptEditor.selectionEnd = start + 2;
    }
});
