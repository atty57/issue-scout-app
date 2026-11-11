import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  // Handlers are kept by name, because the test config clears mock call history between tests.
  const listen = (target) => (name, fn) => { target.events[name] = fn; };
  const webContents = { mainFrame: { url: "" }, setWindowOpenHandler: vi.fn(), setZoomFactor: vi.fn(), events: {} };
  webContents.on = listen(webContents);
  const instance = { webContents, events: {}, show: vi.fn(), maximize: vi.fn() };
  instance.on = instance.once = listen(instance);
  const window = { setBackgroundColor: vi.fn(), setTitleBarOverlay: vi.fn() };
  return { webContents, instance, window, loadURL: vi.fn(), backend: vi.fn(), handle: vi.fn(), openExternal: vi.fn(), backendOptions: {} };
});
vi.mock("electron", () => {
  const BrowserWindow = vi.fn(function (options) {
    harness.windowOptions = options;
    return { ...harness.instance, loadURL: harness.loadURL };
  });
  BrowserWindow.fromWebContents = (contents) => (contents === harness.webContents ? {} : null);
  BrowserWindow.getAllWindows = () => [harness.window];
  const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
  return {
    app: { getPath: () => "unused-test-user-data", whenReady: () => Promise.resolve(), on: vi.fn() },
    BrowserWindow, dialog: {}, ipcMain: { handle: harness.handle }, safeStorage: {}, shell: { openExternal: harness.openExternal },
    Menu: { setApplicationMenu: vi.fn() },
    screen: { getAllDisplays: () => [{ workArea }], getPrimaryDisplay: () => ({ workArea }) },
  };
});
vi.mock("./backend.js", () => ({ createBackend: (options) => { harness.backendOptions = options; return harness.backend; } }));
vi.mock("./repositories.js", () => ({ createRepositoryStore: () => ({}), createEmailStore: () => ({}) }));

let handler, indexUrl, open, channels;
beforeAll(async () => {
  await import("./main.js");
  handler = harness.handle.mock.calls[0][1];
  indexUrl = harness.loadURL.mock.calls[0][0];
  open = harness.webContents.setWindowOpenHandler.mock.calls[0][0];
  channels = harness.handle.mock.calls.map(([channel]) => channel);
});
beforeEach(() => {
  harness.webContents.mainFrame.url = indexUrl;
  harness.backend.mockReset().mockResolvedValue([200, { onboarding: "ready" }]);
});

it("forwards structured repository bodies from the main app frame through the single IPC channel", async () => {
  expect(channels).toEqual(["scout:request"]);
  harness.webContents.mainFrame.url += "#/settings";
  const body = { mode: "create", name: "issue-scout" };
  const response = await handler({ sender: harness.webContents, senderFrame: harness.webContents.mainFrame }, "/api/repository", "POST", body);
  expect(response[0]).toBe(200);
  expect(harness.backend).toHaveBeenCalledWith("/api/repository", "POST", body);
});

it("loads the app page from a file URL that decodes back to the built index.html", () => {
  expect(indexUrl).toBe(pathToFileURL(fileURLToPath(indexUrl)).href);
  expect(fileURLToPath(indexUrl)).toMatch(/[\\/]dist[\\/]index\.html$/);
});

it("rejects other local pages, subframes, and other renderer processes", async () => {
  const event = { sender: harness.webContents, senderFrame: harness.webContents.mainFrame };
  expect((await handler({ ...event, sender: {} }, "/api/me", "GET"))[0]).toBe(400);
  expect((await handler({ ...event, senderFrame: { ...event.senderFrame } }, "/api/me", "GET"))[0]).toBe(400);
  harness.webContents.mainFrame.url = "file:///C:/other-page.html";
  expect((await handler(event, "/api/me", "GET"))[0]).toBe(400);
  expect(harness.backend).not.toHaveBeenCalled();
});

it("opens a sandboxed window with the app icon and a title bar in the saved theme, recolored on theme changes", async () => {
  const options = harness.windowOptions;
  expect(options).toMatchObject({ title: "Issue Scout", backgroundColor: "#f7f8fa" }); // no saved theme: light
  // Nothing saved: the default size, centered on the primary display's work area, shown once painted.
  expect(options).toMatchObject({ x: 320, y: 86, width: 1280, height: 860, show: false });
  expect(existsSync(options.icon)).toBe(true);
  expect(options.webPreferences).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false, zoomFactor: 1 });
  const windows = process.platform === "win32";
  if (windows) expect(options).toMatchObject({ titleBarStyle: "hidden", titleBarOverlay: { color: "#ffffff", symbolColor: "#242b30", height: 36 } });
  harness.backendOptions.setWindowTheme("dark");
  expect(harness.window.setBackgroundColor).toHaveBeenLastCalledWith("#18181b");
  if (windows) expect(harness.window.setTitleBarOverlay).toHaveBeenLastCalledWith({ color: "#1c1c1f", symbolColor: "#f0f0f2", height: 36 });
  harness.backendOptions.setWindowTheme("#123456"); // anything else changes nothing
  expect(harness.window.setBackgroundColor).toHaveBeenCalledTimes(1);
});

it("zooms with Chrome's keys and Ctrl + mouse wheel, growing the title bar with the page", () => {
  const { events, setZoomFactor } = harness.webContents;
  const key = (input) => {
    const event = { preventDefault: vi.fn() };
    events["before-input-event"](event, { type: "keyDown", control: true, alt: false, meta: false, ...input });
    return event.preventDefault.mock.calls.length > 0;
  };
  expect(key({ key: "=", code: "Equal" })).toBe(true);
  expect(setZoomFactor).toHaveBeenLastCalledWith(1.1);
  events["zoom-changed"]({}, "in");
  expect(setZoomFactor).toHaveBeenLastCalledWith(1.25);
  if (process.platform === "win32") expect(harness.window.setTitleBarOverlay).toHaveBeenLastCalledWith(expect.objectContaining({ height: 45 }));
  expect(key({ key: "0", code: "Digit0" })).toBe(true);
  expect(setZoomFactor).toHaveBeenLastCalledWith(1);
  expect(key({ key: "=", code: "Equal", control: false })).toBe(false); // typing "=" is just typing
  expect(setZoomFactor).toHaveBeenCalledTimes(3);
  harness.instance.events["ready-to-show"]();
  expect(harness.instance.show).toHaveBeenCalled();
  expect(harness.instance.maximize).not.toHaveBeenCalled(); // it wasn't maximized last time
});

it("opens only HTTPS external links and denies new renderer windows", () => {
  harness.openExternal.mockClear();
  for (const url of ["file:///C:/Windows", "http://example.com", "javascript:alert(1)"])
    expect(open({ url })).toEqual({ action: "deny" });
  expect(harness.openExternal).not.toHaveBeenCalled();
  expect(open({ url: "https://github.com/octocat/issue-scout" })).toEqual({ action: "deny" });
  expect(harness.openExternal).toHaveBeenCalledWith("https://github.com/octocat/issue-scout");
});
