// Boing for Mac: a native app window around https://app.useboing.com, with the
// Boing engine bundled inside.
//
// The site itself is the app, so every Publish in Lovable shows up here instantly.
// This file adds what a browser tab can't: Dock icon, menus, boing:// links, an
// offline screen, auto-updates, and starting the engine that renders from the DAW.
//
// Electron runs Chromium, so the page reaches the engine on 127.0.0.1:8765 exactly
// as it does in Chrome. The engine still only answers https://app.useboing.com and
// only listens on this Mac; nothing here loosens that.
const { app, BrowserWindow, Menu, shell, session, dialog, screen } = require("electron");
const { spawn, spawnSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const APP_URL = "https://app.useboing.com";
const SITE_URL = "https://useboing.com";
const ENGINE_HEALTH = "http://127.0.0.1:8765/health";
// Pages that stay inside the app window: Boing itself, sign-in, checkout, and the
// Box / Dropbox connection screens. Everything else opens in the normal browser.
const IN_APP_HOSTS = [
  /(^|\.)useboing\.com$/,
  /(^|\.)supabase\.co$/,
  /(^|\.)stripe\.com$/,
  /^account\.box\.com$/,
  /^app\.box\.com$/,
  /(^|\.)dropbox\.com$/,
];
const BOING_HOSTS = /(^|\.)useboing\.com$/;

let win = null;
let pendingUrl = null; // a boing:// link that arrived before the window existed

const isInApp = (url) => {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return IN_APP_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
};

/** boing://d/<token> -> https://useboing.com/d/<token>; anything else -> the app. */
const fromDeepLink = (link) => {
  try {
    const u = new URL(link);
    if (u.protocol !== "boing:") return null;
    const p = `/${u.host}${u.pathname}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    if (p.startsWith("/d/")) return `${SITE_URL}${p}`;
    return `${APP_URL}${p === "/" ? "" : p}${u.search}`;
  } catch {
    return null;
  }
};

// ---------- Engine ----------
// The engine is the same signed, notarized Boing app people install today
// (menu-bar icon, licence check, renders). It ships inside this app as the zip
// build_and_ship.sh makes, and is unpacked with ditto on first launch of each
// version: ditto keeps the code signature intact, which copying the .app into
// this bundle would not (its symlinks get flattened).
const engineZip = () => path.join(process.resourcesPath, "engine.zip");
const engineDir = () => path.join(app.getPath("userData"), "engine");
const engineApp = () => path.join(engineDir(), app.getVersion(), "Boing.app");

function engineUp() {
  return new Promise((resolve) => {
    const req = http.get(ENGINE_HEALTH, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/** Unpack this version's engine once, and drop engines left by older versions. */
function installEngine() {
  const target = engineApp();
  if (fs.existsSync(path.join(target, "Contents", "MacOS"))) return target;
  if (!fs.existsSync(engineZip())) return null;
  const dir = path.dirname(target);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync("ditto", ["-x", "-k", engineZip(), dir], { stdio: "ignore" });
  if (r.status !== 0 || !fs.existsSync(target)) return null;
  for (const old of fs.readdirSync(engineDir())) {
    if (old !== app.getVersion()) fs.rmSync(path.join(engineDir(), old), { recursive: true, force: true });
  }
  return target;
}

async function startEngine() {
  if (!app.isPackaged) return; // `npm start` uses whatever engine is already running
  if (await engineUp()) return; // already running (e.g. an older standalone install)
  const engine = installEngine();
  if (!engine) {
    dialog.showMessageBox({
      type: "warning",
      message: "Boing couldn't start its engine",
      detail: "Renders need the engine. Reinstall Boing from useboing.com, or contact support if this keeps happening.",
    });
    return;
  }
  // -g: start in the background so this window keeps focus. The engine keeps
  // running in the menu bar after the window closes, so a render in progress
  // isn't cut off; quit it from its menu-bar icon.
  spawn("open", ["-g", "-a", engine], { stdio: "ignore", detached: true }).unref();
}

// ---------- Window size memory ----------
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
      b.x >= a.x - 50 && b.y >= a.y - 50 && b.x < a.x + a.width && b.y < a.y + a.height);
    return onScreen ? b : { width: b.width, height: b.height };
  } catch {
    return { width: 1360, height: 900 };
  }
}
function saveBounds() {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds())); } catch { /* ignore */ }
}

// ---------- Main window ----------
function createWindow() {
  const bounds = loadBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 1000,
    minHeight: 680,
    title: "Boing",
    backgroundColor: "#0E0E11",
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  // Lets the site know it's running in the desktop app (e.g. hide "use Chrome" notes).
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} BoingDesktop/${app.getVersion()}`);

  win.once("ready-to-show", () => win.show());
  win.on("resize", saveBounds);
  win.on("move", saveBounds);
  win.on("closed", () => { win = null; });

  // Links to other websites open in the person's normal browser, not inside Boing.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInApp(url)) return { action: "allow", overrideBrowserWindowOptions: { backgroundColor: "#0E0E11" } };
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isInApp(url)) return;
    e.preventDefault();
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
  });

  // No internet: a calm offline screen with a retry button instead of an error page.
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = navigation cancelled, not a failure
    const retry = url && url.startsWith("http") ? url : APP_URL;
    win.loadFile(path.join(__dirname, "offline.html"), { query: { retry } });
  });

  win.loadURL(pendingUrl || APP_URL);
  pendingUrl = null;
}

function openInApp(url) {
  if (!url) return;
  if (!win) { pendingUrl = url; return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.loadURL(url);
}

// ---------- Permissions ----------
// Boing pages may: notify, write to the clipboard (Copy link / Copy path), go
// fullscreen, and reach the local engine (Chromium's local-network permission).
// Nothing else, and nothing for any other site.
function setupPermissions() {
  const allowed = new Set([
    "notifications",
    "clipboard-sanitized-write",
    "fullscreen",
    "local-network-access",
    "local-network",
    "loopback-network",
  ]);
  const fromBoing = (wc) => {
    try { return BOING_HOSTS.test(new URL(wc.getURL()).hostname); } catch { return false; }
  };
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(fromBoing(wc) && allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    return !!wc && fromBoing(wc) && allowed.has(permission);
  });
}

// ---------- Menus ----------
function buildMenu() {
  const go = (url) => () => openInApp(url);
  const template = [
    {
      label: "Boing",
      submenu: [
        { role: "about" },
        { label: "Check for Updates…", click: () => checkForUpdates(true) },
        { type: "separator" },
        { label: "Account & Billing…", accelerator: "Cmd+,", click: () => shell.openExternal(`${SITE_URL}/settings`) },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "Go",
      submenu: [
        { label: "Deliver", accelerator: "Cmd+Shift+H", click: go(APP_URL) },
        { type: "separator" },
        { label: "Back", accelerator: "Cmd+[", click: () => win?.webContents.navigationHistory?.canGoBack() && win.webContents.navigationHistory.goBack() },
        { label: "Forward", accelerator: "Cmd+]", click: () => win?.webContents.navigationHistory?.canGoForward() && win.webContents.navigationHistory.goForward() },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Boing Website", click: () => shell.openExternal(SITE_URL) },
        { label: "Tutorials", click: () => shell.openExternal(`${SITE_URL}/tutorials`) },
        { label: "Contact Support", click: () => shell.openExternal(`${SITE_URL}/legal/contact`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Auto-updates (from GitHub Releases) ----------
// A release carries both the window and the engine, so updating Boing updates both.
let updater = null;
function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) dialog.showMessageBox({ message: "Updates are checked in the installed app only." });
    return;
  }
  try {
    if (!updater) {
      updater = require("electron-updater").autoUpdater;
      updater.autoDownload = true;
      updater.on("update-downloaded", async (info) => {
        const { response } = await dialog.showMessageBox({
          type: "info",
          buttons: ["Restart Now", "Later"],
          defaultId: 0,
          message: `Boing ${info.version} is ready`,
          detail: "Restart Boing to finish updating. If a render is running, finish it first: the engine restarts too.",
        });
        if (response === 0) updater.quitAndInstall();
      });
      if (manual) {
        updater.once("update-not-available", () => dialog.showMessageBox({ message: "You're on the latest version of Boing." }));
      }
    }
    updater.checkForUpdates().catch(() => undefined);
  } catch {
    /* updates are best-effort; the app keeps working */
  }
}

// ---------- App lifecycle ----------
app.setName("Boing");
app.setAsDefaultProtocolClient("boing");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const link = argv.find((a) => a.startsWith("boing://"));
    openInApp(link ? fromDeepLink(link) : null);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  // macOS delivers boing:// links here, sometimes before the app is ready.
  app.on("open-url", (e, link) => {
    e.preventDefault();
    const url = fromDeepLink(link);
    if (app.isReady()) openInApp(url);
    else pendingUrl = url;
  });

  app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: "Boing",
      applicationVersion: app.getVersion(),
      copyright: "Effortless deliverables.",
      website: SITE_URL,
    });
    setupPermissions();
    buildMenu();
    startEngine();
    createWindow();
    checkForUpdates();
    setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000);

    // Clicking the Dock icon with no window open brings Boing back (and the engine, if it was quit).
    app.on("activate", () => {
      startEngine();
      if (!win) createWindow(); else win.show();
    });
  });

  // Mac apps stay running when the window closes; Cmd+Q quits.
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
