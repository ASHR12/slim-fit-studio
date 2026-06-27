const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("winControl", {
  getPosition: () => ipcRenderer.invoke("win:getPosition"),
  setPosition: (x, y) => ipcRenderer.send("win:setPosition", x, y),
  close: () => ipcRenderer.send("win:close"),
  minimize: () => ipcRenderer.send("win:minimize"),
  toggleMaximize: () => ipcRenderer.send("win:toggleMaximize")
});
