import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBackend } from "./backend.js";
import { GITHUB_CLIENT_ID } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const tokenFile = () => path.join(app.getPath("userData"), "github-token.bin");

// The GitHub token is only ever written encrypted by the OS (DPAPI, Keychain or libsecret).
const tokens = {
  load() {
    try {
      return safeStorage.decryptString(readFileSync(tokenFile()));
    } catch {
      return null;
    }
  },
  save(token) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("This computer has no secure storage for your GitHub sign-in.");
    writeFileSync(tokenFile(), safeStorage.encryptString(token));
  },
  clear() {
    rmSync(tokenFile(), { force: true });
  },
};

const openExternal = (url) => (url.startsWith("https://") ? shell.openExternal(url) : undefined);
const backend = createBackend({
  tokens,
  clientId: process.env.ISSUE_SCOUT_GITHUB_CLIENT_ID?.trim() || GITHUB_CLIENT_ID,
  openExternal,
});

ipcMain.handle("scout:request", (event, route, method) => {
  if (!event.senderFrame?.url.startsWith("file://") || typeof route !== "string" || typeof method !== "string")
    return [400, { error: "Invalid request." }];
  return backend(route, method);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: { preload: path.join(here, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  void win.loadFile(path.join(here, "..", "dist", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
