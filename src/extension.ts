import * as vscode from "vscode";
import * as http from "http";
import * as https from "https";
import { URL } from "url";
import * as fs from "fs";
import * as path from "path";

type Status = "unknown" | "up" | "slow" | "down";

class ApiNode extends vscode.TreeItem {
  constructor(
    public readonly name: string,
    public readonly url: string,
    public readonly status: Status,
    public readonly tooltip?: string,
    public readonly icon?: vscode.Uri,
  ) {
    super(name);
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

class DevAliveProvider implements vscode.TreeDataProvider<ApiNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    ApiNode | null | undefined
  > = new vscode.EventEmitter<ApiNode | null | undefined>();
  readonly onDidChangeTreeData: vscode.Event<ApiNode | null | undefined> =
    this._onDidChangeTreeData.event;

  private statusMap: Map<string, Status> = new Map();
  private lastMsMap: Map<string, number | null> = new Map();
  private interval?: any;
  private output: vscode.OutputChannel;
  private statusBar?: vscode.StatusBarItem;

  constructor(private context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel("DevAlive");
    this.output.appendLine("DevAlive provider initializing...");
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.context.subscriptions.push(this.statusBar);
    this.start();
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("devalive")) {
        this.restart();
      }
    });
  }

  // Helper to read endpoints preferring workspace config file
  private getEndpointsSync(): any[] {
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        const cfgPath = path.join(
          folders[0].uri.fsPath,
          ".vscode",
          "devalive.json",
        );
        if (fs.existsSync(cfgPath)) {
          try {
            const raw = fs.readFileSync(cfgPath, "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
            if (parsed && Array.isArray(parsed.endpoints))
              return parsed.endpoints;
          } catch (e) {
            // ignore parse errors and fall back to settings
          }
        }
      }
      const cfg = vscode.workspace.getConfiguration("devalive");
      return cfg.get<any[]>("endpoints", []);
    } catch (e) {
      return [];
    }
  }

  start() {
    this.checkOnce();
    const cfg = vscode.workspace.getConfiguration("devalive");
    const interval = cfg.get<number>("pingInterval", 5000);
    this.interval = setInterval(
      () => this.checkOnce(),
      Math.max(1000, interval),
    );
  }

  restart() {
    if (this.interval) {
      clearInterval(this.interval);
    }
    this.start();
  }

  dispose() {
    if (this.interval) clearInterval(this.interval);
  }

  refresh(): void {
    this.updateStatusBar();
    this._onDidChangeTreeData.fire();
  }

  private updateStatusBar() {
    try {
      const endpoints = this.getEndpointsSync();
      const total = endpoints ? endpoints.length : 0;
      let down = 0;
      endpoints?.forEach((e) => {
        const s = this.statusMap.get(e.name);
        if (s === "down") down++;
      });
      if (this.statusBar) {
        if (total === 0) {
          this.statusBar.hide();
        } else {
          this.statusBar.text = `DevAlive: ${down}/${total} down`;
          this.statusBar.tooltip = "DevAlive endpoints status";
          this.statusBar.show();
        }
      }
    } catch (e) {
      // ignore
    }
  }

  getTreeItem(element: ApiNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element;
  }

  getChildren(): vscode.ProviderResult<ApiNode[]> {
    const endpoints = this.getEndpointsSync();
    if (!endpoints || endpoints.length === 0) {
      const n = new ApiNode(
        "No endpoints configured",
        "",
        "unknown",
        "Nenhum endpoint encontrado. Use o comando 'DevAlive: Add Endpoint' ou configure 'devalive.endpoints'",
      );
      return [n];
    }

    return endpoints.map((ep) => {
      const status = this.statusMap.get(ep.name) ?? "unknown";
      const last = this.lastMsMap.get(ep.name) ?? null;
      const tooltip =
        last == null ? `${ep.url}` : `${ep.url}\nResposta em ${last} ms`;
      const icon = this.iconForStatus(status);
      return new ApiNode(ep.name, ep.url, status, tooltip, icon);
    });
  }

  private iconForStatus(s: Status): vscode.Uri | undefined {
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

  private checkOnce() {
    const endpoints = this.getEndpointsSync();
    const cfg = vscode.workspace.getConfiguration("devalive");
    const timeout = Math.max(200, cfg.get<number>("timeout", 2000));
    const slowThreshold = Math.max(50, cfg.get<number>("slowThreshold", 1000));

    endpoints.forEach((ep) => {
      let timedOut = false;
      try {
        const url = new URL(ep.url);
        const lib = url.protocol === "https:" ? https : http;
        const start = Date.now();
        const name = ep.name;
        const req = lib.get(
          {
            hostname: url.hostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname + url.search,
            method: "GET",
            timeout: timeout,
          },
          (res) => {
            res.on("data", () => {});
            res.on("end", () => {
              const ms = Date.now() - start;
              this.lastMsMap.set(name, ms);
              if (ms > timeout) {
                this.statusMap.set(name, "down");
                this.output.appendLine(`${name}: down (ms=${ms})`);
              } else if (ms > slowThreshold) {
                this.statusMap.set(name, "slow");
                this.output.appendLine(`${name}: slow (ms=${ms})`);
              } else {
                this.statusMap.set(name, "up");
                this.output.appendLine(`${name}: up (ms=${ms})`);
              }
              this.refresh();
            });
          },
        );

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
      } catch (err) {
        this.statusMap.set(ep.name, "down");
        this.lastMsMap.set(ep.name, null);
        this.output.appendLine(`${ep.name}: check failed: ${err}`);
        this.refresh();
      }
    });
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new DevAliveProvider(context);
  const treeView = vscode.window.createTreeView("devaliveExplorer", {
    treeDataProvider: provider,
  });
  context.subscriptions.push(treeView, provider);

  // Config view removed to keep Explorer simple; use commands to manage endpoints.

  // helper to save endpoints only to workspace-scoped settings
  async function saveEndpointsWorkspace(endpoints: any[]) {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const cfgDir = path.join(folders[0].uri.fsPath, ".vscode");
      const cfgPath = path.join(cfgDir, "devalive.json");
      try {
        if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
        await fs.promises.writeFile(
          cfgPath,
          JSON.stringify(endpoints, null, 2),
          "utf8",
        );
        provider.restart();
        return true;
      } catch (err) {
        vscode.window.showErrorMessage(`Falha ao salvar ${cfgPath}: ${err}`);
        return false;
      }
    } else {
      vscode.window.showErrorMessage(
        "Abra uma pasta ou workspace para salvar as configurações por projeto.",
      );
      return false;
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("devalive.refresh", () =>
      provider.refresh(),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("devalive.addEndpoint", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Endpoint name (e.g. dev, hml, local)",
      });
      if (!name) return;
      const url = await vscode.window.showInputBox({
        prompt: "Endpoint URL (e.g. http://localhost:3000/health)",
      });
      if (!url) return;
      const endpoints: any[] = (provider as any).getEndpointsSync
        ? (provider as any).getEndpointsSync()
        : [];
      endpoints.push({ name, url });
      await saveEndpointsWorkspace(endpoints);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "devalive.removeEndpoint",
      async (node?: ApiNode) => {
        let endpoints: any[] = (provider as any).getEndpointsSync
          ? (provider as any).getEndpointsSync()
          : [];
        if (!node) {
          const pick = await vscode.window.showQuickPick(
            endpoints.map((e: any) => e.name),
          );
          if (!pick) return;
          endpoints = endpoints.filter((e) => e.name !== pick);
        } else {
          endpoints = endpoints.filter((e) => e.name !== node.name);
        }
        await saveEndpointsWorkspace(endpoints);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "devalive.openEndpoint",
      async (node?: ApiNode) => {
        const endpoints: any[] = (provider as any).getEndpointsSync
          ? (provider as any).getEndpointsSync()
          : [];
        let url: string | undefined;
        if (node) url = node.url;
        else {
          const pick = await vscode.window.showQuickPick<{
            label: string;
            description: string;
          }>(
            endpoints.map((e: any) => ({ label: e.name, description: e.url })),
            { placeHolder: "Select endpoint to open" },
          );
          if (!pick) return;
          url = pick.description;
        }
        if (url) vscode.env.openExternal(vscode.Uri.parse(url));
      },
    ),
  );

  // Command to open or create the workspace config file (.vscode/devalive.json)
  context.subscriptions.push(
    vscode.commands.registerCommand("devalive.openConfig", async () => {
      // Open a small WebviewPanel with a simple form to add/remove endpoints
      const panel = vscode.window.createWebviewPanel(
        "devaliveConfig",
        "DevAlive — Config",
        vscode.ViewColumn.One,
        { enableScripts: true },
      );
      const endpoints: any[] = (provider as any).getEndpointsSync
        ? (provider as any).getEndpointsSync()
        : [];
      panel.webview.html = getConfigHtml(panel.webview, endpoints);
      panel.webview.onDidReceiveMessage(async (msg: any) => {
        if (msg.command === "add") {
          const cur: any[] = (provider as any).getEndpointsSync
            ? (provider as any).getEndpointsSync()
            : [];
          cur.push({ name: msg.name, url: msg.url });
          const ok = await saveEndpointsWorkspace(cur);
          if (ok)
            panel.webview.postMessage({ command: "updated", endpoints: cur });
        } else if (msg.command === "remove") {
          const cur: any[] = (provider as any).getEndpointsSync
            ? (provider as any).getEndpointsSync()
            : [];
          const next = cur.filter((e) => e.name !== msg.name);
          const ok = await saveEndpointsWorkspace(next);
          if (ok)
            panel.webview.postMessage({ command: "updated", endpoints: next });
        }
      });
    }),
  );
}

export function deactivate() {}
// config webview removed — keeping the extension focused and simple

function getConfigHtml(webview: vscode.Webview, endpoints: any[]) {
  const nonce = Date.now();
  const rows = (endpoints || [])
    .map(
      (e: any) =>
        `<tr><td>${e.name}</td><td>${e.url}</td><td><button data-name="${e.name}" class="remove">Remove</button></td></tr>`,
    )
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
