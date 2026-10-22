import { app, BrowserWindow, dialog } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import * as http from 'node:http';
import * as path from 'node:path';

/**
 * Zoveli desktop shell: starts the local web server as a child
 * process, waits for /health, then opens it in a window. No remote
 * servers, no accounts, no telemetry — same local-first guarantees as
 * the CLI. Packaged installers (with OS signing) are future work; run
 * with `pnpm --filter @zoveli/desktop start`.
 */

const PORT = parseInt(process.env.ZOVELI_DESKTOP_PORT || '3080', 10);
const HOST = '127.0.0.1';
const SERVER_ENTRY = path.join(__dirname, 'server', 'server.js');

let serverProc: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    serverProc = spawn(process.execPath, [SERVER_ENTRY], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'ignore',
    });
    serverProc.on('error', reject);
    serverProc.on('exit', (code) => {
      if (!winOpen) {
        reject(new Error(`zoveli-web exited before ready (code ${code})`));
      }
    });
    pollHealth(resolve, reject);
  });
}

let winOpen = false;
let attempts = 0;

function pollHealth(resolve: () => void, reject: (e: Error) => void): void {
  attempts++;
  const req = http.get(
    { host: HOST, port: PORT, path: '/health', timeout: 2000 },
    (res) => {
      res.resume();
      if (res.statusCode === 200) {
        resolve();
      } else if (attempts > 60) {
        reject(new Error('zoveli-web health check failed'));
      } else {
        setTimeout(() => pollHealth(resolve, reject), 500);
      }
    }
  );
  req.on('error', () => {
    if (serverProc?.exitCode !== null && serverProc?.exitCode !== undefined) {
      reject(new Error('zoveli-web process died during startup'));
    } else if (attempts > 60) {
      reject(new Error('zoveli-web did not become ready in time'));
    } else {
      setTimeout(() => pollHealth(resolve, reject), 500);
    }
  });
  req.on('timeout', () => req.destroy());
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Zoveli AI',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });
  winOpen = true;
  mainWindow.on('closed', () => {
    mainWindow = null;
    winOpen = false;
  });
  void mainWindow.loadURL(`http://${HOST}:${PORT}/`);
}

async function boot(): Promise<void> {
  const lock = app.requestSingleInstanceLock();
  if (!lock) {
    app.quit();
    return;
  }
  await app.whenReady();
  try {
    await startServer();
  } catch (e) {
    dialog.showErrorBox(
      'Zoveli failed to start',
      e instanceof Error ? e.message : String(e)
    );
    app.quit();
    return;
  }
  // Headless smoke hook (CI / verification): prove server boot works
  // end-to-end without opening a window.
  if (process.env.ZOVELI_DESKTOP_SMOKE === '1') {
    console.log(`Zoveli desktop smoke OK: server healthy on ${HOST}:${PORT}`);
    shutdown();
    app.quit();
    return;
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function shutdown(): void {
  try {
    serverProc?.kill();
  } catch {
    // already gone
  }
  serverProc = null;
}

app.on('window-all-closed', () => {
  shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', shutdown);

void boot();

