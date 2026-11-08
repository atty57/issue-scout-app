import { app, BrowserWindow, ipcMain, Menu, safeStorage, shell } from "electron";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBackend } from "./backend.js";
import { GITHUB_CLIENT_ID } from "./config.js";
import { createRepositoryStore } from "./repositories.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const tokenFile = () => path.join(app.getPath("userData"), "github-token.bin");
const indexFile = path.join(here, "..", "dist", "index.html");
// Load our own encoded URL rather than loadFile, so the URL Chromium reports always decodes back to
// indexFile, even for install folders with "%" or spaces in their names.
const indexUrl = pathToFileURL(indexFile).href;
const isAppPage = (url) => {
  try {
    return path.relative(fileURLToPath(url), indexFile) === "";
  } catch {
    return false;
  }
};

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
  repositories: createRepositoryStore(path.join(app.getPath("userData"), "repositories.json")),
  clientId: process.env.ISSUE_SCOUT_GITHUB_CLIENT_ID?.trim() || GITHUB_CLIENT_ID,
  openExternal,
});

// Registered once, so creating another window can't register the channel twice. Only the main frame
// of one of this app's windows, showing the app page, may use it.
ipcMain.handle("scout:request", (event, route, method, body) => {
  const frame = event.senderFrame;
  if (!BrowserWindow.fromWebContents(event.sender) || !frame || frame !== event.sender.mainFrame || !isAppPage(frame.url) ||
      typeof route !== "string" || typeof method !== "string")
    return [400, { error: "Invalid request." }];
  return backend(route, method, body);
});

function createWindow() {
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
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
  void win.loadURL(indexUrl);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
