// The page's only bridge to the app: one request channel answered by electron/backend.js.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("scout", {
  request: (route, method, body) => ipcRenderer.invoke("scout:request", route, method, body),
});
