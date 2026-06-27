const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, session, systemPreferences, shell, ipcMain } = require("electron");

// Manual window dragging (CSS app-region is unreliable on some macOS builds).
ipcMain.handle("win:getPosition", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? win.getPosition() : [0, 0];
});
ipcMain.on("win:setPosition", (event, x, y) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setPosition(Math.round(x), Math.round(y));
});
ipcMain.on("win:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  if (win) win.close();
});
ipcMain.on("win:minimize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  if (win) win.minimize();
});
ipcMain.on("win:toggleMaximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

let logFile = null;
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  try {
    if (!logFile) logFile = path.join(app.getPath("userData"), "slimfit.log");
    fs.appendFileSync(logFile, line);
  } catch (_) {}
  process.stdout.write(line);
}

// The native USB control runs under the bundled Node 20 (a child process),
// NOT under Electron's runtime — this avoids recompiling the libusb native
// module for Electron's ABI while keeping everything in one codebase.
const isPackaged = app.isPackaged;
const baseDir = isPackaged
  ? path.join(process.resourcesPath, "app-payload")
  : path.join(__dirname, "..");
const serverScript = path.join(baseDir, "server.js");
const nodeBin = path.join(
  baseDir,
  "node_modules",
  "node",
  "bin",
  process.platform === "win32" ? "node.exe" : "node"
);

let serverProcess = null;
let mainWindow = null;
let serverPort = 0;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function startServer(port) {
  log(`Spawning server: node=${nodeBin} script=${serverScript} port=${port}`);
  serverProcess = spawn(nodeBin, [serverScript], {
    cwd: baseDir,
    env: { ...process.env, PORT: String(port), ELECTRON_RUN_AS_NODE: undefined },
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout.on("data", (d) => log(`[server] ${String(d).trim()}`));
  serverProcess.stderr.on("data", (d) => log(`[server-err] ${String(d).trim()}`));
  serverProcess.on("error", (err) => log(`[server] spawn error: ${err.message}`));
  serverProcess.on("exit", (code) => {
    log(`[server] exited with code ${code}`);
    serverProcess = null;
  });
}

function waitForServer(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1500 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("Server did not start in time"));
        else setTimeout(tryOnce, 250);
      });
      req.on("timeout", () => {
        req.destroy();
        if (Date.now() > deadline) reject(new Error("Server did not start in time"));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 880,
    minHeight: 620,
    backgroundColor: "#000000",
    title: "Slim Fit Studio",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 17 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Open any external links in the system browser, not inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function grantCameraPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === "media");
}

async function bootstrap() {
  log(`Bootstrap. packaged=${isPackaged} baseDir=${baseDir}`);
  log(`serverScript exists=${fs.existsSync(serverScript)} nodeBin exists=${fs.existsSync(nodeBin)}`);
  grantCameraPermissions();

  try {
    serverPort = await getFreePort();
    startServer(serverPort);
    await waitForServer(serverPort);
    log(`Server ready on ${serverPort}, opening window`);
    createWindow();
  } catch (error) {
    log(`Failed to start: ${error.message}`);
    app.quit();
    return;
  }

  // Request camera access AFTER the UI is up, without blocking startup.
  if (process.platform === "darwin") {
    systemPreferences.askForMediaAccess("camera").catch(() => {});
  }
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
}

app.whenReady().then(bootstrap);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverPort) createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", stopServer);
app.on("will-quit", stopServer);
process.on("exit", stopServer);
