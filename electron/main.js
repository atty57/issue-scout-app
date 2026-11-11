import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, shell } from "electron";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBackend } from "./backend.js";
import { EMAIL_RELAY_URL, GITHUB_CLIENT_ID } from "./config.js";
import { createEmailStore, createRepositoryStore } from "./repositories.js";
import { nextZoom, readWindowState, windowBounds, writeWindowState, zoomKey } from "./window-state.js";

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
// A run's report or patch, saved where the user picks. electron/runs.js builds `name` from the run id and a fixed file name.
async function saveFile({ name, content }) {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options = { defaultPath: path.join(app.getPath("downloads"), name) };
  const { canceled, filePath } = await (window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options));
  if (canceled || !filePath) return false;
  await writeFile(filePath, content, "utf8");
  return true;
}
// Windows: the page draws the title bar (logo and name, .window-titlebar in src/styles.css) and Windows draws
// minimize, maximize and close over its right end, in the theme's --sidebar and --text colors. The page reports
// each theme change (PUT /api/window/theme). The bar grows with the zoom, so it stays in proportion with the page.
const customTitleBar = process.platform === "win32";
const TITLE_BAR_HEIGHT = 36;
const THEMES = {
  light: { background: "#f7f8fa", overlay: { color: "#ffffff", symbolColor: "#242b30" } },
  dark: { background: "#18181b", overlay: { color: "#1c1c1f", symbolColor: "#f0f0f2" } },
};
const stateFile = () => path.join(app.getPath("userData"), "window.json");
let state; // theme, zoom, bounds and maximized, read when the window opens (electron/window-state.js)
const titleBarOverlay = () => ({ ...THEMES[state.theme].overlay, height: Math.round(TITLE_BAR_HEIGHT * state.zoom) });
function restyleWindows() {
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(THEMES[state.theme].background);
    if (customTitleBar) win.setTitleBarOverlay(titleBarOverlay());
  }
  writeWindowState(stateFile(), state);
}
function setWindowTheme(theme) {
  if (!state || !THEMES[theme]) return;
  state.theme = theme;
  restyleWindows();
}
const backend = createBackend({
  tokens,
  repositories: createRepositoryStore(path.join(app.getPath("userData"), "repositories.json")),
  clientId: process.env.ISSUE_SCOUT_GITHUB_CLIENT_ID?.trim() || GITHUB_CLIENT_ID,
  emailRelayUrl: process.env.ISSUE_SCOUT_EMAIL_RELAY_URL?.trim() || EMAIL_RELAY_URL,
  emailStore: createEmailStore(path.join(app.getPath("userData"), "email.json")),
  openExternal,
  saveFile,
  setWindowTheme,
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
  state = readWindowState(stateFile());
  const bounds = windowBounds(state.bounds, screen.getAllDisplays().map((display) => display.workArea), screen.getPrimaryDisplay().workArea);
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    title: "Issue Scout",
    icon: path.join(here, "icon.png"),
    backgroundColor: THEMES[state.theme].background,
    ...(customTitleBar && { titleBarStyle: "hidden", titleBarOverlay: titleBarOverlay() }),
    webPreferences: {
      preload: path.join(here, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, zoomFactor: state.zoom,
    },
  });
  win.once("ready-to-show", () => {
    if (state.maximized) win.maximize();
    win.show();
  });
  win.on("close", () => {
    state.bounds = win.getNormalBounds();
    state.maximized = win.isMaximized();
    writeWindowState(stateFile(), state);
  });
  // Chrome's zoom keys and Ctrl + mouse wheel; the app has no menu to provide them.
  const zoom = (direction) => {
    state.zoom = nextZoom(state.zoom, direction);
    win.webContents.setZoomFactor(state.zoom);
    restyleWindows();
  };
  win.webContents.on("before-input-event", (event, input) => {
    const direction = zoomKey(input);
    if (!direction) return;
    event.preventDefault();
    zoom(direction);
  });
  win.webContents.on("zoom-changed", (_event, direction) => zoom(direction));
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  void win.loadURL(indexUrl);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
