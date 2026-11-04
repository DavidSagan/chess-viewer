const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("viewerHost", {
  ready: () => ipcRenderer.send("renderer-ready"),
  pdfOpened: (name) => ipcRenderer.send("pdf-opened", name),
  pdfFailed: (name) => ipcRenderer.send("pdf-failed", name),
  openLink: (href) => ipcRenderer.send("open-link", href),
  dragStart: () => ipcRenderer.send("drag-start"),
  dragEnd: (fraction) => ipcRenderer.send("drag-end", fraction),
  onLoadPdf: (callback) => ipcRenderer.on("load-pdf", (_event, file) => callback(file)),
  onCommand: (callback) => ipcRenderer.on("command", (_event, command) => callback(command)),
});
