"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const url_1 = require("url");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class ApiNode extends vscode.TreeItem {
    constructor(name, url, status, tooltip, icon) {
        super(name);
        this.name = name;
        this.url = url;
        this.status = status;
        this.tooltip = tooltip;
        this.icon = icon;
        this.description = status === "unknown" ? "" : status;
        this.tooltip = tooltip;
        if (icon) {
            this.iconPath = icon;
        }
        this.contextValue = "endpoint";
        if (this.url) {
            this.command = {
                command: "devalive.openEndpoint",
                title: "Open endpoint",
                arguments: [this],
            };
        }
    }
}
class DevAliveProvider {
    constructor(context) {
        this.context = context;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.statusMap = new Map();
        this.lastMsMap = new Map();
        this.output = vscode.window.createOutputChannel("DevAlive");
        this.output.appendLine("DevAlive provider initializing...");
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.context.subscriptions.push(this.statusBar);
        this.start();
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("devalive")) {
                this.restart();
            }
        });
    }
    // Helper to read endpoints preferring workspace config file
    getEndpointsSync() {
        try {
            const folders = vscode.workspace.workspaceFolders;
            if (folders && folders.length > 0) {
                const cfgPath = path.join(folders[0].uri.fsPath, ".vscode", "devalive.json");
                if (fs.existsSync(cfgPath)) {
                    try {
                        const raw = fs.readFileSync(cfgPath, "utf8");
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed))
                            return parsed;
                        if (parsed && Array.isArray(parsed.endpoints))
                            return parsed.endpoints;
                    }
                    catch (e) {
                        // ignore parse errors and fall back to settings
                    }
                }
            }
            const cfg = vscode.workspace.getConfiguration("devalive");
            return cfg.get("endpoints", []);
        }
        catch (e) {
            return [];
        }
    }
    start() {
        this.checkOnce();
        const cfg = vscode.workspace.getConfiguration("devalive");
        const interval = cfg.get("pingInterval", 5000);
        this.interval = setInterval(() => this.checkOnce(), Math.max(1000, interval));
    }
    restart() {
        if (this.interval) {
            clearInterval(this.interval);
        }
        this.start();
    }
    dispose() {
        if (this.interval)
            clearInterval(this.interval);
    }
    refresh() {
        this.updateStatusBar();
        this._onDidChangeTreeData.fire();
    }
    updateStatusBar() {
        try {
            const endpoints = this.getEndpointsSync();
            const total = endpoints ? endpoints.length : 0;
            let down = 0;
            endpoints === null || endpoints === void 0 ? void 0 : endpoints.forEach((e) => {
                const s = this.statusMap.get(e.name);
                if (s === "down")
                    down++;
            });
            if (this.statusBar) {
                if (total === 0) {
                    this.statusBar.hide();
                }
                else {
                    this.statusBar.text = `DevAlive: ${down}/${total} down`;
                    this.statusBar.tooltip = "DevAlive endpoints status";
                    this.statusBar.show();
                }
            }
        }
        catch (e) {
            // ignore
        }
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        const endpoints = this.getEndpointsSync();
        if (!endpoints || endpoints.length === 0) {
            const n = new ApiNode("No endpoints configured", "", "unknown", "Nenhum endpoint encontrado. Use o comando 'DevAlive: Add Endpoint' ou configure 'devalive.endpoints'");
            return [n];
        }
        return endpoints.map((ep) => {
            var _a, _b;
            const status = (_a = this.statusMap.get(ep.name)) !== null && _a !== void 0 ? _a : "unknown";
            const last = (_b = this.lastMsMap.get(ep.name)) !== null && _b !== void 0 ? _b : null;
            const tooltip = last == null ? `${ep.url}` : `${ep.url}\nResposta em ${last} ms`;
            const icon = this.iconForStatus(status);
            return new ApiNode(ep.name, ep.url, status, tooltip, icon);
        });
    }
    iconForStatus(s) {
        const base = this.context.asAbsolutePath("resources");
        switch (s) {
            case "up":
                return vscode.Uri.file(`${base}/green.svg`);
            case "slow":
                return vscode.Uri.file(`${base}/yellow.svg`);
            case "down":
                return vscode.Uri.file(`${base}/red.svg`);
            default:
                return undefined;
        }
    }
    checkOnce() {
        const endpoints = this.getEndpointsSync();
        const cfg = vscode.workspace.getConfiguration("devalive");
        const timeout = Math.max(200, cfg.get("timeout", 2000));
        const slowThreshold = Math.max(50, cfg.get("slowThreshold", 1000));
        endpoints.forEach((ep) => {
            let timedOut = false;
            try {
                const url = new url_1.URL(ep.url);
                const lib = url.protocol === "https:" ? https : http;
                const start = Date.now();
                const name = ep.name;
                const req = lib.get({
                    hostname: url.hostname,
                    port: url.port || (url.protocol === "https:" ? 443 : 80),
                    path: url.pathname + url.search,
                    method: "GET",
                    timeout: timeout,
                }, (res) => {
                    res.on("data", () => { });
                    res.on("end", () => {
                        const ms = Date.now() - start;
                        this.lastMsMap.set(name, ms);
                        if (ms > timeout) {
                            this.statusMap.set(name, "down");
                            this.output.appendLine(`${name}: down (ms=${ms})`);
                        }
                        else if (ms > slowThreshold) {
                            this.statusMap.set(name, "slow");
                            this.output.appendLine(`${name}: slow (ms=${ms})`);
                        }
                        else {
                            this.statusMap.set(name, "up");
                            this.output.appendLine(`${name}: up (ms=${ms})`);
                        }
                        this.refresh();
                    });
                });
                req.on("timeout", () => {
                    timedOut = true;
                    req.abort();
                });
                req.on("error", () => {
                    this.statusMap.set(ep.name, "down");
                    this.lastMsMap.set(ep.name, null);
                    this.output.appendLine(`${ep.name}: request error`);
                    this.refresh();
                });
            }
            catch (err) {
                this.statusMap.set(ep.name, "down");
                this.lastMsMap.set(ep.name, null);
                this.output.appendLine(`${ep.name}: check failed: ${err}`);
                this.refresh();
            }
        });
    }
}
function activate(context) {
    const provider = new DevAliveProvider(context);
    const treeView = vscode.window.createTreeView("devaliveExplorer", {
        treeDataProvider: provider,
    });
    context.subscriptions.push(treeView, provider);
    // Config view removed to keep Explorer simple; use commands to manage endpoints.
    // helper to save endpoints only to workspace-scoped settings
    async function saveEndpointsWorkspace(endpoints) {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            const cfgDir = path.join(folders[0].uri.fsPath, ".vscode");
            const cfgPath = path.join(cfgDir, "devalive.json");
            try {
                if (!fs.existsSync(cfgDir))
                    fs.mkdirSync(cfgDir, { recursive: true });
                await fs.promises.writeFile(cfgPath, JSON.stringify(endpoints, null, 2), "utf8");
                provider.restart();
                return true;
            }
            catch (err) {
                vscode.window.showErrorMessage(`Falha ao salvar ${cfgPath}: ${err}`);
                return false;
            }
        }
        else {
            vscode.window.showErrorMessage("Abra uma pasta ou workspace para salvar as configurações por projeto.");
            return false;
        }
    }
    context.subscriptions.push(vscode.commands.registerCommand("devalive.refresh", () => provider.refresh()));
    context.subscriptions.push(vscode.commands.registerCommand("devalive.addEndpoint", async () => {
        const name = await vscode.window.showInputBox({
            prompt: "Endpoint name (e.g. dev, hml, local)",
        });
        if (!name)
            return;
        const url = await vscode.window.showInputBox({
            prompt: "Endpoint URL (e.g. http://localhost:3000/health)",
        });
        if (!url)
            return;
        const endpoints = provider.getEndpointsSync
            ? provider.getEndpointsSync()
            : [];
        endpoints.push({ name, url });
        await saveEndpointsWorkspace(endpoints);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("devalive.removeEndpoint", async (node) => {
        let endpoints = provider.getEndpointsSync
            ? provider.getEndpointsSync()
            : [];
        if (!node) {
            const pick = await vscode.window.showQuickPick(endpoints.map((e) => e.name));
            if (!pick)
                return;
            endpoints = endpoints.filter((e) => e.name !== pick);
        }
        else {
            endpoints = endpoints.filter((e) => e.name !== node.name);
        }
        await saveEndpointsWorkspace(endpoints);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("devalive.openEndpoint", async (node) => {
        const endpoints = provider.getEndpointsSync
            ? provider.getEndpointsSync()
            : [];
        let url;
        if (node)
            url = node.url;
        else {
            const pick = await vscode.window.showQuickPick(endpoints.map((e) => ({ label: e.name, description: e.url })), { placeHolder: "Select endpoint to open" });
            if (!pick)
                return;
            url = pick.description;
        }
        if (url)
            vscode.env.openExternal(vscode.Uri.parse(url));
    }));
    // Command to open or create the workspace config file (.vscode/devalive.json)
    context.subscriptions.push(vscode.commands.registerCommand("devalive.openConfig", async () => {
        // Open a small WebviewPanel with a simple form to add/remove endpoints
        const panel = vscode.window.createWebviewPanel("devaliveConfig", "DevAlive — Config", vscode.ViewColumn.One, { enableScripts: true });
        const endpoints = provider.getEndpointsSync
            ? provider.getEndpointsSync()
            : [];
        panel.webview.html = getConfigHtml(panel.webview, endpoints);
        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === "add") {
                const cur = provider.getEndpointsSync
                    ? provider.getEndpointsSync()
                    : [];
                cur.push({ name: msg.name, url: msg.url });
                const ok = await saveEndpointsWorkspace(cur);
                if (ok)
                    panel.webview.postMessage({ command: "updated", endpoints: cur });
            }
            else if (msg.command === "remove") {
                const cur = provider.getEndpointsSync
                    ? provider.getEndpointsSync()
                    : [];
                const next = cur.filter((e) => e.name !== msg.name);
                const ok = await saveEndpointsWorkspace(next);
                if (ok)
                    panel.webview.postMessage({ command: "updated", endpoints: next });
            }
        });
    }));
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
// config webview removed — keeping the extension focused and simple
function getConfigHtml(webview, endpoints) {
    const nonce = Date.now();
    const rows = (endpoints || [])
        .map((e) => `<tr><td>${e.name}</td><td>${e.url}</td><td><button data-name="${e.name}" class="remove">Remove</button></td></tr>`)
        .join("");
    return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body{ font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial; padding:10px; }
      table{ width:100%; border-collapse:collapse; margin-bottom:8px }
      th,td{ padding:6px 8px; border-bottom:1px solid #eee }
      .controls{ display:flex; gap:8px; align-items:center }
      input{ padding:6px }
      button{ padding:6px 10px }
      .remove{ background:#e11d48;color:#fff;border:none;border-radius:4px }
      .add{ background:#16a34a;color:#fff;border:none;border-radius:4px }
    </style>
  </head>
  <body>
    <h3 style="margin:0 0 8px 0">DevAlive Endpoints</h3>
    <table>
      <thead><tr><th>Name</th><th>URL</th><th></th></tr></thead>
      <tbody id="list">
        ${rows}
      </tbody>
    </table>
    <div class="controls">
      <input id="name" placeholder="name" />
      <select id="proto"><option value="http://">http://</option><option value="https://">https://</option></select>
      <input id="url" placeholder="host/path (without protocol)" style="flex:1" />
      <button id="add" class="add">Add</button>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.getElementById('add').addEventListener('click', ()=>{
        const name = document.getElementById('name').value;
        const proto = document.getElementById('proto').value;
        const urlPart = document.getElementById('url').value;
        if(!name || !urlPart) return;
        vscode.postMessage({command:'add', name, url: proto + urlPart});
      });
      document.getElementById('list').addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.classList && t.classList.contains('remove')) {
          const name = t.getAttribute('data-name');
          vscode.postMessage({ command: 'remove', name });
        }
      });
      window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.command === 'updated') {
          const tbody = document.getElementById('list');
          tbody.innerHTML = msg.endpoints.map(function(e){
            return '<tr><td>'+e.name+'</td><td>'+e.url+'</td><td><button data-name="'+e.name+'" class="remove">Remove</button></td></tr>';
          }).join('');
        }
      });
    </script>
  </body>
  </html>`;
}
//# sourceMappingURL=extension.js.map