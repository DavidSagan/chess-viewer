// Drives the real app with real clicks. Usage: node test/smoke.js [file.pdf]
// The PDF must have Lichess links and links within the document. To test a packaged app, set
// VIEWER_EXECUTABLE to its executable.

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const electronPath = require("electron");
const { _electron } = require("playwright-core");

const viewerDir = path.join(__dirname, "..");
const defaultPdf = path.join(viewerDir, "..", "examples", "rubinstein-capablanca", "rubinstein-capablanca.pdf");
const pdf = path.resolve(process.argv[2] ?? defaultPdf);

async function panelUrl(app) {
  return app.evaluate(({ webContents }) => {
    const panel = webContents.getAllWebContents().find((c) => !c.getURL().startsWith("app:"));
    return panel.getURL();
  });
}

async function waitFor(check, what, details = async () => "") {
  const deadline = Date.now() + 30000;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what} ${await details()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const menu = (app, id) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), id);
const place = (page) => page.evaluate(() => {
  const container = document.getElementById("viewerContainer");
  return { top: container.scrollTop, height: container.scrollHeight };
});

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "chess-viewer-test-"));
  const app = await _electron.launch({
    executablePath: process.env.VIEWER_EXECUTABLE ?? electronPath,
    args: [...(process.env.VIEWER_EXECUTABLE ? [] : [viewerDir]), pdf, `--user-data-dir=${userData}`, ...(process.env.CI && process.platform === "linux" ? ["--no-sandbox"] : [])],
  });
  const errors = [];
  try {
    const page = await waitFor(() => app.windows().find((w) => w.url().startsWith("app:")), "the PDF window");
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.waitForSelector(".annotationLayer a[href]", { state: "attached", timeout: 30000 });

    const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
    assert.equal(title, path.basename(pdf));

    // Pages fit the width of the left side
    const fit = await page.evaluate(() => ({
      page: document.querySelector(".page").clientWidth,
      side: document.getElementById("pdf-side").clientWidth,
    }));
    assert.ok(fit.page <= fit.side && fit.page > fit.side * 0.85, `page ${fit.page} in side ${fit.side}`);

    // A Lichess link goes to the panel, and no window opens
    const lichess = page.locator('.annotationLayer a[href*="lichess.org"]').first();
    await lichess.scrollIntoViewIfNeeded();
    const href = await lichess.getAttribute("href");
    await lichess.click();
    await waitFor(async () => (await panelUrl(app)).includes(new URL(href).pathname), "the panel to show the move");
    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    assert.equal(windows, 1);

    // Another site goes to the default browser, and other link types go nowhere
    await app.evaluate(({ shell }) => { globalThis.opened = []; shell.openExternal = async (url) => { globalThis.opened.push(url); }; });
    const before = await panelUrl(app);
    await page.evaluate(() => {
      for (const href of ["https://example.com/page", "file:///etc/hosts"]) {
        const link = document.createElement("a");
        link.href = href;
        link.textContent = "x";
        document.querySelector(".annotationLayer").append(link);
        link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        link.remove();
      }
    });
    await waitFor(() => app.evaluate(() => globalThis.opened.length > 0), "the default browser");
    assert.deepEqual(await app.evaluate(() => globalThis.opened), ["https://example.com/page"]);
    assert.equal(await panelUrl(app), before);

    // A link within the PDF moves the page, and Back returns
    await page.evaluate(() => { document.getElementById("viewerContainer").scrollTop = 0; });
    await page.waitForSelector('.page[data-page-number="1"] .annotationLayer a[href^="#"]', { state: "attached", timeout: 30000 });
    const start = await place(page);
    await page.locator('.page[data-page-number="1"] .annotationLayer a[href^="#"]').last().click();
    const jumped = await waitFor(async () => { const p = await place(page); return p.top > start.top + 10 && p; }, "the internal link");
    await menu(app, "go-back");
    await waitFor(async () => Math.abs((await place(page)).top - start.top) < 2, "Back");

    // First Page, then Back to where it was
    await page.evaluate((top) => { document.getElementById("viewerContainer").scrollTop = top; }, jumped.top);
    await menu(app, "go-first");
    await waitFor(async () => (await place(page)).top < 2, "First Page");
    await menu(app, "go-back");
    await waitFor(async () => Math.abs((await place(page)).top - jumped.top) < 2, "Back from First Page");

    // Zoom
    const width = () => page.evaluate(() => document.querySelector(".page").clientWidth);
    const zoomStart = await width();
    await menu(app, "zoom-in");
    await waitFor(async () => (await width()) > zoomStart, "Zoom In");
    await menu(app, "zoom-out");
    await menu(app, "zoom-out");
    await waitFor(async () => (await width()) < zoomStart, "Zoom Out");

    // Dragging the divider, with the panel following
    const box = await page.locator("#divider").boundingBox();
    await page.mouse.move(box.x + box.width / 2, 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, 300, { steps: 5 });
    await page.mouse.up();
    const panelState = () => app.evaluate(({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children[0];
      return { visible: view.getVisible(), x: view.getBounds().x };
    });
    const wanted = box.x + box.width + 200;
    await waitFor(async () => {
      const state = await panelState();
      return state.visible && Math.abs(state.x - wanted) < 12;
    }, "the panel to follow the divider", async () => JSON.stringify({ wanted, panel: await panelState() }));

    // A file that is not a PDF is refused, and the open one stays
    const bad = path.join(userData, "bad.pdf");
    fs.writeFileSync(bad, "not a pdf");
    await app.evaluate(({ dialog }) => { globalThis.alerts = []; dialog.showMessageBox = async (_w, options) => { globalThis.alerts.push(options.message); return { response: 0 }; }; });
    await app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), bad);
    await waitFor(() => app.evaluate(() => globalThis.alerts.length > 0), "the error message");
    assert.deepEqual(await app.evaluate(() => globalThis.alerts), ["Could not open bad.pdf"]);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), path.basename(pdf));
    assert.ok(await page.locator(".page").count() > 0);

    assert.deepEqual(errors.filter((e) => !e.includes("Invalid PDF")), []);
    console.log("Passed:", path.basename(pdf));
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
