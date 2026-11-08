import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const webContents = { mainFrame: { url: "" }, setWindowOpenHandler: vi.fn(), on: vi.fn() };
  return { webContents, loadURL: vi.fn(), backend: vi.fn(), handle: vi.fn(), openExternal: vi.fn() };
});
vi.mock("electron", () => {
  const BrowserWindow = vi.fn(function () { return { webContents: harness.webContents, loadURL: harness.loadURL }; });
  BrowserWindow.fromWebContents = (contents) => (contents === harness.webContents ? {} : null);
  return {
    app: { getPath: () => "unused-test-user-data", whenReady: () => Promise.resolve(), on: vi.fn() },
    BrowserWindow, ipcMain: { handle: harness.handle }, safeStorage: {}, shell: { openExternal: harness.openExternal },
    Menu: { setApplicationMenu: vi.fn() },
  };
});
vi.mock("./backend.js", () => ({ createBackend: () => harness.backend }));
vi.mock("./repositories.js", () => ({ createRepositoryStore: () => ({}) }));

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

it("opens only HTTPS external links and denies new renderer windows", () => {
  harness.openExternal.mockClear();
  for (const url of ["file:///C:/Windows", "http://example.com", "javascript:alert(1)"])
    expect(open({ url })).toEqual({ action: "deny" });
  expect(harness.openExternal).not.toHaveBeenCalled();
  expect(open({ url: "https://github.com/octocat/issue-scout" })).toEqual({ action: "deny" });
  expect(harness.openExternal).toHaveBeenCalledWith("https://github.com/octocat/issue-scout");
});
