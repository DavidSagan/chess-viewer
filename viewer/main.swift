// Chess Book Viewer: a PDF on the left and Lichess on the right. Clicking a move in the PDF
// shows it in the Lichess panel, with no prompt and no new browser tabs or windows.

import Cocoa
import PDFKit
import WebKit

let startPage = URL(string: "https://lichess.org/analysis")!

final class AppDelegate: NSObject, NSApplicationDelegate, PDFViewDelegate, WKUIDelegate {
  let pdfView = PDFView()
  let webView = WKWebView()
  var window: NSWindow!

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()

    pdfView.autoScales = true
    pdfView.displayMode = .singlePageContinuous
    pdfView.delegate = self
    webView.uiDelegate = self

    let split = NSSplitView()
    split.isVertical = true
    split.dividerStyle = .thin
    split.addArrangedSubview(pdfView)
    split.addArrangedSubview(webView)

    let frame = NSScreen.main?.visibleFrame.insetBy(dx: 40, dy: 40)
                ?? NSRect(x: 0, y: 0, width: 1400, height: 900)
    window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                      backing: .buffered, defer: false)
    // A file given by Finder may have arrived before the window existed
    window.title = pdfView.document?.documentURL?.lastPathComponent ?? "Chess Book Viewer"
    window.contentView = split
    window.makeKeyAndOrderFront(nil)
    split.setPosition(frame.width * 0.5, ofDividerAt: 0)
    NSApp.activate(ignoringOtherApps: true)

    webView.load(URLRequest(url: startPage))

    // A file given by Finder arrives through application(_:openFile:)
    DispatchQueue.main.async {
      if self.pdfView.document == nil {
        if let path = CommandLine.arguments.dropFirst().first(where: { $0.hasSuffix(".pdf") }) {
          _ = self.open(URL(fileURLWithPath: path))
        } else {
          self.openDocument(nil)
        }
      }
      #if SELFTEST
      runSelfTest(self)
      #endif
    }
  }

  func application(_ sender: NSApplication, openFile filename: String) -> Bool {
    return open(URL(fileURLWithPath: filename))
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return true
  }

  func open(_ url: URL) -> Bool {
    guard let document = PDFDocument(url: url) else { return false }
    pdfView.document = document
    window?.title = url.lastPathComponent
    return true
  }

  @objc func openDocument(_ sender: Any?) {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.pdf]
    if panel.runModal() == .OK, let url = panel.url, !open(url) {
      let alert = NSAlert()
      alert.messageText = "Could not open \(url.lastPathComponent)"
      alert.runModal()
    }
  }

  // A clicked link: Lichess goes to the panel, anything else to the default browser.
  func pdfViewWillClick(onLink sender: PDFView, with url: URL) {
    if url.host == "lichess.org" {
      webView.load(URLRequest(url: url))
    } else {
      NSWorkspace.shared.open(url)
    }
  }

  // A page asking for a new window or tab: stay in the panel.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if navigationAction.targetFrame == nil {
      webView.load(navigationAction.request)
    }
    return nil
  }

  func buildMenu() {
    let main = NSMenu()

    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Quit Chess Book Viewer", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

    let fileMenu = NSMenu(title: "File")
    fileMenu.addItem(withTitle: "Open…", action: #selector(openDocument(_:)), keyEquivalent: "o")
    fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

    let editMenu = NSMenu(title: "Edit")
    editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

    let viewMenu = NSMenu(title: "View")
    let zoomIn = viewMenu.addItem(withTitle: "Zoom PDF In", action: #selector(PDFView.zoomIn(_:)), keyEquivalent: "+")
    zoomIn.target = pdfView
    let zoomOut = viewMenu.addItem(withTitle: "Zoom PDF Out", action: #selector(PDFView.zoomOut(_:)), keyEquivalent: "-")
    zoomOut.target = pdfView

    for menu in [appMenu, fileMenu, editMenu, viewMenu] {
      main.addItem(withTitle: menu.title, action: nil, keyEquivalent: "").submenu = menu
    }
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
