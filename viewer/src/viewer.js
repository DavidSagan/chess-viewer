// The PDF side of the window, drawn by PDF.js.

const PDFJS = "../node_modules/pdfjs-dist/";

// pdf_viewer.mjs finds PDF.js through a global that pdf.mjs sets, so the order matters.
const pdfjs = await import(`${PDFJS}build/pdf.mjs`);
const { EventBus, PDFLinkService, PDFViewer } = await import(`${PDFJS}web/pdf_viewer.mjs`);

pdfjs.GlobalWorkerOptions.workerSrc = new URL(`${PDFJS}build/pdf.worker.mjs`, import.meta.url).href;

const AUTO_SCALE = "page-width";
const container = document.getElementById("viewerContainer");
const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus, ignoreDestinationZoom: true });
const pdfViewer = new PDFViewer({ container, eventBus, linkService });
linkService.setViewer(pdfViewer);

let currentDocument = null;
let history = [];

eventBus.on("pagesinit", () => {
  pdfViewer.currentScaleValue = AUTO_SCALE;
});

window.viewerHost.onLoadPdf(async ({ name, data }) => {
  let loaded;
  try {
    loaded = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      cMapUrl: new URL(`${PDFJS}cmaps/`, import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL(`${PDFJS}standard_fonts/`, import.meta.url).href,
      iccUrl: new URL(`${PDFJS}iccs/`, import.meta.url).href,
      wasmUrl: new URL(`${PDFJS}wasm/`, import.meta.url).href,
    }).promise;
  } catch {
    window.viewerHost.pdfFailed(name);
    return;
  }
  const previous = currentDocument;
  currentDocument = loaded;
  history = [];
  pdfViewer.setDocument(loaded);
  linkService.setDocument(loaded);
  previous?.destroy();
  window.viewerHost.pdfOpened(name);
  container.focus();
});

// The place in the document, kept as a page and a fraction of it so that it survives zooming.
function currentPlace() {
  const pageNumber = pdfViewer.currentPageNumber;
  const page = pdfViewer.getPageView(pageNumber - 1)?.div;
  if (!page) return null;
  return { pageNumber, offset: (container.scrollTop - page.offsetTop) / page.clientHeight };
}

function goToPlace({ pageNumber, offset }) {
  const page = pdfViewer.getPageView(pageNumber - 1).div;
  container.scrollTop = page.offsetTop + offset * page.clientHeight;
}

function remember() {
  const place = currentPlace();
  if (place) history.push(place);
}

// Links are handled here, before PDF.js sees them. Links inside the PDF go on to PDF.js.
container.addEventListener("click", (event) => {
  const link = event.target.closest?.(".annotationLayer a[href]");
  if (!link) return;
  if (link.getAttribute("href").startsWith("#")) {
    remember();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  window.viewerHost.openLink(link.href);
}, true);

const commands = {
  "zoom-in": () => pdfViewer.increaseScale(),
  "zoom-out": () => pdfViewer.decreaseScale(),
  "first-page": () => {
    if (!currentDocument) return;
    remember();
    pdfViewer.currentPageNumber = 1;
    container.scrollTop = 0;
  },
  "back": () => {
    const place = history.pop();
    if (place && currentDocument) goToPlace(place);
  },
};

window.viewerHost.onCommand((command) => commands[command]?.());

// Keep the pages fitted to the side's width unless the reader has zoomed.
function fitPages() {
  if (currentDocument && pdfViewer.currentScaleValue === AUTO_SCALE) {
    pdfViewer.currentScaleValue = AUTO_SCALE;
  }
}

// Redrawing the pages at every step of a drag would be slow, so that waits for the end of it.
new ResizeObserver(() => {
  if (dragFraction === null) fitPages();
}).observe(container);

const divider = document.getElementById("divider");
let dragFraction = null;

function fractionAt(event) {
  return Math.min(0.85, Math.max(0.15, event.clientX / window.innerWidth));
}

divider.addEventListener("pointerdown", (event) => {
  dragFraction = fractionAt(event);
  window.viewerHost.dragStart();
});

// A move with no button held is not part of the drag, such as one the system sends when the panel
// is hidden.
document.addEventListener("pointermove", (event) => {
  if (dragFraction === null || !(event.buttons & 1)) return;
  dragFraction = fractionAt(event);
  document.documentElement.style.setProperty("--split", `${dragFraction * 100}%`);
});

function endDrag() {
  if (dragFraction === null) return;
  window.viewerHost.dragEnd(dragFraction);
  dragFraction = null;
  fitPages();
}

document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
window.addEventListener("blur", endDrag);

window.viewerHost.ready();
