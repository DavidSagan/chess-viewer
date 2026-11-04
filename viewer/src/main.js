// Chess PDF Viewer: a PDF on the left and Lichess on the right. Clicking a move in the PDF
// shows it in the Lichess panel, with no prompt and no new browser tabs or windows.

const { app, BrowserWindow, Menu, WebContentsView, dialog, ipcMain, protocol, screen, session, shell } = require("electron");
const fs = require("fs/promises");
const path = require("path");

const START_PAGE = "https://lichess.org/analysis";
const APP_ROOT = path.join(__dirname, "..");
const APP_URL = "app://viewer/src/index.html";
const CONTENT_TYPES = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif", ".wasm": "application/wasm",
};

let window = null;
let panel = null;
let split = 0.5;
let rendererReady = false;
let pendingFile = app.isPackaged ? process.argv.slice(1).find(isPdf) : process.argv.slice(2).find(isPdf);

function isPdf(arg) {
  return arg.toLowerCase().endsWith(".pdf") && !arg.startsWith("-");
}

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Serves the app's own page and PDF.js, and nothing outside them.
async function serveAppFile(request) {
  const relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
  const file = path.normalize(path.join(APP_ROOT, relative));
  const allowed = [path.join(APP_ROOT, "src"), path.join(APP_ROOT, "node_modules", "pdfjs-dist")];
  if (!allowed.some((dir) => file.startsWith(dir + path.sep))) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const type = CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";
    return new Response(await fs.readFile(file), { headers: { "content-type": type } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function layoutPanel() {
  const [width, height] = window.getContentSize();
  const x = Math.round(width * split);
  panel.setBounds({ x, y: 0, width: width - x, height });
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  window = new BrowserWindow({
    x: area.x + 40,
    y: area.y + 40,
    width: area.width - 80,
    height: area.height - 80,
    title: "Chess PDF Viewer",
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true },
  });
  window.on("page-title-updated", (event) => event.preventDefault());
  window.on("resize", layoutPanel);
  window.on("closed", () => { window = null; panel = null; });

  // The PDF side never leaves the app's own page, such as when a file is dropped on it.
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  panel = new WebContentsView({
    webPreferences: { partition: "persist:lichess", sandbox: true, contextIsolation: true },
  });
  // A page asking for a new window or tab: stay in the panel.
  panel.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) panel.webContents.loadURL(url);
    return { action: "deny" };
  });
  session.fromPartition("persist:lichess").setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.contentView.addChildView(panel);
  layoutPanel();

  window.loadURL(APP_URL);
  panel.webContents.loadURL(START_PAGE);
}

async function openFile(file) {
  if (!rendererReady) {
    pendingFile = file;
    return;
  }
  const name = path.basename(file);
  try {
    const data = await fs.readFile(file);
    window.webContents.send("load-pdf", { name, data });
  } catch {
    showOpenError(name);
  }
}

function showOpenError(name) {
  dialog.showMessageBox(window, { type: "warning", message: `Could not open ${name}` });
}

async function chooseFile() {
  const result = await dialog.showOpenDialog(window, {
    properties: ["openFile"],
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!result.canceled) await openFile(result.filePaths[0]);
}

function send(command) {
  window?.webContents.send("command", command);
}

function buildMenu() {
  const mac = process.platform === "darwin";
  const template = [
    ...(mac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { id: "file-open", label: "Open…", accelerator: "CmdOrCtrl+O", click: chooseFile },
        { role: "close", label: "Close Window" },
        ...(mac ? [] : [{ role: "quit" }]),
      ],
    },
    {
      label: "Edit",
      submenu: [{ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    },
    {
      label: "View",
      submenu: [
        { id: "zoom-in", label: "Zoom PDF In", accelerator: "CmdOrCtrl+Plus", click: () => send("zoom-in") },
        { label: "Zoom PDF In", accelerator: "CmdOrCtrl+=", visible: false, acceleratorWorksWhenHidden: true, click: () => send("zoom-in") },
        { id: "zoom-out", label: "Zoom PDF Out", accelerator: "CmdOrCtrl+-", click: () => send("zoom-out") },
      ],
    },
    {
      label: "Go",
      submenu: [
        { id: "go-first", label: "First Page", accelerator: "CmdOrCtrl+Up", click: () => send("first-page") },
        { id: "go-back", label: "Back", accelerator: "CmdOrCtrl+[", click: () => send("back") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on("renderer-ready", () => {
  rendererReady = true;
  if (pendingFile) {
    openFile(pendingFile);
    pendingFile = null;
  } else {
    chooseFile();
  }
});

ipcMain.on("pdf-opened", (_event, name) => window?.setTitle(name));
ipcMain.on("pdf-failed", (_event, name) => showOpenError(name));

// A clicked link: Lichess goes to the panel, any other web link to the default browser.
ipcMain.on("open-link", (_event, href) => {
  let url;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;
  if (url.hostname === "lichess.org") {
    panel.webContents.loadURL(url.href);
  } else {
    shell.openExternal(url.href);
  }
});

// The panel draws over the window, so it is hidden while the divider is dragged. Otherwise it
// would take the mouse from the page as the pointer crosses it.
ipcMain.on("drag-start", () => panel.setVisible(false));
ipcMain.on("drag-end", (_event, fraction) => {
  split = Math.min(0.85, Math.max(0.15, fraction));
  layoutPanel();
  panel.setVisible(true);
});

// A file given by Finder.
app.on("open-file", (event, file) => {
  event.preventDefault();
  openFile(file);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A file given to a second copy of the app, on Windows and Linux.
  app.on("second-instance", (_event, argv) => {
    const file = argv.slice(1).find(isPdf);
    if (file) openFile(file);
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });

  app.whenReady().then(() => {
    protocol.handle("app", serveAppFile);
    buildMenu();
    createWindow();
  });

  app.on("window-all-closed", () => app.quit());
}
