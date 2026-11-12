import Cocoa
import WebKit

private let petURL = URL(string: "http://127.0.0.1:47901/pet?nativeMenu=1")!
private let pidPath = ("~/.dsh/session-status-pet.pid" as NSString).expandingTildeInPath
private let defaultPetSize = NSSize(width: 300, height: 50)
private let minPetSize = NSSize(width: 180, height: 46)
private let maxPetSize = NSSize(width: 560, height: 96)
private let hiddenKey = "petHidden"

final class PetPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSMenuDelegate {
  private var panel: PetPanel!
  private var webView: WKWebView!
  private var statusItem: NSStatusItem!
  private var showItem: NSMenuItem!
  private var hideItem: NSMenuItem!
  private var dragOrigin = NSPoint.zero
  private var signalSource: DispatchSourceSignal?
  private var hideSignalSource: DispatchSourceSignal?
  private var terminationSources: [DispatchSourceSignal] = []
  private var rightClickDownMonitor: Any?
  private var rightClickUpMonitor: Any?
  private var pendingContextPoint: NSPoint?
  private var retryWork: DispatchWorkItem?
  private var lastPhase = "standby"
  private var lastLabel = "待命"
  private var lastTime = "READY"
  private var petSize = defaultPetSize
  private var pageReady = false
  private var visibilitySeq = 0

  private var hiddenByUser: Bool {
    get { UserDefaults.standard.bool(forKey: hiddenKey) }
    set { UserDefaults.standard.set(newValue, forKey: hiddenKey) }
  }

  private func text(_ zh: String, _ en: String) -> String {
    Locale.preferredLanguages.first?.hasPrefix("zh") == true ? zh : en
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    petSize = savedPetSize()
    if CommandLine.arguments.contains("--show") {
      hiddenByUser = false
    }
    if CommandLine.arguments.contains("--hide") {
      hiddenByUser = true
    }
    createPanel()
    installRightClickMenu()
    createStatusItem()
    load()
    if hiddenByUser {
      panel.orderOut(nil)
    } else {
      panel.orderFrontRegardless()
    }
    updateStatusItem()
    writePid()
    installSignals()
    reportVisibility()
  }

  private func createPanel() {
    let origin = savedOrigin()
    panel = PetPanel(
      contentRect: NSRect(origin: origin, size: petSize),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.hidesOnDeactivate = false
    panel.isMovableByWindowBackground = false
    panel.becomesKeyOnlyIfNeeded = true
    panel.isFloatingPanel = true
    panel.titleVisibility = .hidden
    panel.titlebarAppearsTransparent = true

    let config = WKWebViewConfiguration()
    config.userContentController.add(self, name: "pet")
    webView = WKWebView(frame: NSRect(origin: .zero, size: petSize), configuration: config)
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self
    webView.setValue(false, forKey: "drawsBackground")
    panel.contentView?.addSubview(webView)
  }

  private func createStatusItem() {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    if let button = statusItem.button {
      button.image = phaseImage(for: "standby")
      button.imagePosition = .imageOnly
      button.toolTip = "DSH 会话状态"
    }

    let menu = NSMenu()
    menu.delegate = self
    showItem = NSMenuItem(title: text("显示状态", "Show status"), action: #selector(showFromMenu), keyEquivalent: "")
    hideItem = NSMenuItem(title: text("隐藏状态", "Hide status"), action: #selector(hideFromMenu), keyEquivalent: "")
    let dockItem = NSMenuItem(title: text("收回输入框上方", "Dock above composer"), action: #selector(dockFromMenu), keyEquivalent: "")
    let resetItem = NSMenuItem(title: text("重置到右下角", "Reset to bottom-right"), action: #selector(resetFromMenu), keyEquivalent: "")
    let quitItem = NSMenuItem(title: text("退出桌面状态", "Quit desktop status"), action: #selector(quitFromMenu), keyEquivalent: "")
    for item in [showItem!, hideItem!, dockItem, resetItem, quitItem] {
      item.target = self
    }
    menu.addItem(showItem)
    menu.addItem(hideItem)
    menu.addItem(dockItem)
    menu.addItem(.separator())
    menu.addItem(resetItem)
    menu.addItem(.separator())
    menu.addItem(quitItem)
    statusItem.menu = menu
  }

  private func phaseImage(for phase: String) -> NSImage? {
    let symbol: String
    switch phase {
    case "running": symbol = "record.circle"
    case "complete": symbol = "checkmark.circle"
    case "error": symbol = "exclamationmark.triangle"
    default: symbol = "circle"
    }
    let image = NSImage(systemSymbolName: symbol, accessibilityDescription: "DSH session status")
    image?.isTemplate = true
    return image
  }

  private func updateStatusItem(phase: String? = nil, label: String? = nil, time: String? = nil) {
    if let phase { lastPhase = phase }
    if let label, !label.isEmpty { lastLabel = label }
    if let time, !time.isEmpty { lastTime = time }
    if let button = statusItem?.button {
      if let image = phaseImage(for: lastPhase) {
        button.image = image
        button.title = ""
      } else {
        button.image = nil
        button.title = "DSH"
      }
      let hidden = hiddenByUser ? text(" · 已隐藏", " · hidden") : ""
      button.toolTip = "\(text("会话状态", "Session status"))：\(lastLabel) · \(lastTime)\(hidden)"
    }
    showItem?.isEnabled = true
    hideItem?.isEnabled = !hiddenByUser
  }

  func menuWillOpen(_ menu: NSMenu) {
    updateStatusItem()
  }

  @objc private func showFromMenu() {
    showPanel()
    if !pageReady { load() }
  }

  @objc private func hideFromMenu() {
    hidePanel()
  }

  @objc private func dockFromMenu() {
    postJSON(path: "/pet/dock", body: ["pid": ProcessInfo.processInfo.processIdentifier])
    hidePanel()
  }

  @objc private func resetFromMenu() {
    resetPosition()
    showPanel()
    if !pageReady { load() }
  }

  @objc private func quitFromMenu() {
    reportVisibilityAndQuit()
  }

  private func showContextMenu(at point: NSPoint) {
    guard let view = panel.contentView else { return }
    let menu = NSMenu()
    menu.autoenablesItems = false
    let hide = NSMenuItem(title: text("隐藏状态", "Hide status"), action: #selector(hideFromMenu), keyEquivalent: "")
    let dock = NSMenuItem(title: text("收回输入框上方", "Dock above composer"), action: #selector(dockFromMenu), keyEquivalent: "")
    let reset = NSMenuItem(title: text("重置到右下角", "Reset to bottom-right"), action: #selector(resetFromMenu), keyEquivalent: "")
    let quit = NSMenuItem(title: text("退出桌面状态", "Quit desktop status"), action: #selector(quitFromMenu), keyEquivalent: "")
    for item in [hide, dock, reset, quit] {
      item.target = self
    }
    menu.addItem(hide)
    menu.addItem(dock)
    menu.addItem(.separator())
    menu.addItem(reset)
    menu.addItem(.separator())
    menu.addItem(quit)
    let bounds = view.bounds
    let x = min(max(0, point.x), max(0, bounds.width - 1))
    let y = min(max(0, point.y), max(0, bounds.height - 1))
    menu.popUp(positioning: nil, at: NSPoint(x: x, y: y), in: view)
  }

  private func installRightClickMenu() {
    rightClickDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .rightMouseDown) { [weak self] event in
      guard let self, event.window === self.panel else { return event }
      let point = self.panel.contentView?.convert(event.locationInWindow, from: nil) ?? .zero
      self.pendingContextPoint = point
      return nil
    }
    rightClickUpMonitor = NSEvent.addLocalMonitorForEvents(matching: .rightMouseUp) { [weak self] event in
      guard let self, event.window === self.panel else { return event }
      let point = self.pendingContextPoint
        ?? self.panel.contentView?.convert(event.locationInWindow, from: nil)
        ?? .zero
      self.pendingContextPoint = nil
      DispatchQueue.main.async { [weak self] in
        self?.showContextMenu(at: point)
      }
      return nil
    }
  }

  private func showPanel() {
    hiddenByUser = false
    panel.orderFrontRegardless()
    updateStatusItem()
    reportVisibility()
  }

  private func hidePanel() {
    hiddenByUser = true
    panel.orderOut(nil)
    updateStatusItem()
    reportVisibility()
  }

  private func reportVisibility() {
    visibilitySeq += 1
    postJSON(path: "/pet/report", body: [
      "visible": panel?.isVisible ?? false,
      "seq": visibilitySeq,
      "pid": ProcessInfo.processInfo.processIdentifier,
    ])
  }

  private func reportVisibilityAndQuit() {
    visibilitySeq += 1
    let payload: [String: Any] = [
      "visible": false,
      "seq": visibilitySeq,
      "pid": ProcessInfo.processInfo.processIdentifier,
      "quit": true,
    ]
    if let request = jsonRequest(path: "/pet/report", body: payload) {
      URLSession.shared.dataTask(with: request) { _, _, _ in
        DispatchQueue.main.async { NSApp.terminate(nil) }
      }.resume()
    }
    // Report is best-effort; never leave the menu action hanging.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
      NSApp.terminate(nil)
    }
  }

  private func postJSON(path: String, body: [String: Any]) {
    guard let request = jsonRequest(path: path, body: body) else { return }
    URLSession.shared.dataTask(with: request) { _, _, _ in }.resume()
  }

  private func jsonRequest(path: String, body: [String: Any]) -> URLRequest? {
    guard let url = URL(string: "http://127.0.0.1:47901\(path)") else { return nil }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 1.2
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    return request
  }

  private func resetPosition() {
    guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
    let frame = screen.visibleFrame
    let origin = NSPoint(
      x: frame.maxX - petSize.width - 24,
      y: frame.minY + 24
    )
    panel.setFrameOrigin(origin)
    savePlacement()
  }

  private func savedPetSize() -> NSSize {
    guard
      let saved = UserDefaults.standard.object(forKey: "petSize") as? [Double],
      saved.count == 2
    else {
      return defaultPetSize
    }
    return clampedSize(NSSize(width: saved[0], height: saved[1]))
  }

  private func clampedSize(_ size: NSSize) -> NSSize {
    NSSize(
      width: min(max(size.width, minPetSize.width), maxPetSize.width),
      height: min(max(size.height, minPetSize.height), maxPetSize.height)
    )
  }

  private func resizePanel(to requested: NSSize) {
    let next = clampedSize(requested)
    guard
      abs(next.width - petSize.width) > 0.5 ||
      abs(next.height - petSize.height) > 0.5
    else {
      return
    }

    let screen = panel.screen ?? NSScreen.main
    let anchorRight = screen.map {
      $0.visibleFrame.maxX - panel.frame.maxX <= 80
    } ?? true
    let left = panel.frame.minX
    let right = panel.frame.maxX
    let top = panel.frame.maxY
    petSize = next
    panel.setContentSize(next)

    var origin = NSPoint(
      x: anchorRight ? right - next.width : left,
      y: top - next.height
    )
    if let screen {
      origin = clamp(origin, to: screen.visibleFrame)
    }
    panel.setFrameOrigin(origin)
    savePlacement()
  }

  private func savedOrigin() -> NSPoint {
    let defaults = UserDefaults.standard
    if let saved = defaults.object(forKey: "petOrigin") as? [Double], saved.count == 2 {
      let point = NSPoint(x: saved[0], y: saved[1])
      let screen = NSScreen.screens.first(where: { $0.visibleFrame.contains(point) }) ?? NSScreen.main
      if let screen {
        return clamp(point, to: screen.visibleFrame)
      }
      return point
    }
    if let screen = NSScreen.main {
      let frame = screen.visibleFrame
      return NSPoint(x: frame.maxX - petSize.width - 24, y: frame.minY + 24)
    }
    return NSPoint(x: 120, y: 120)
  }

  private func clamp(_ point: NSPoint, to frame: NSRect) -> NSPoint {
    NSPoint(
      x: min(max(point.x, frame.minX), frame.maxX - petSize.width),
      y: min(max(point.y, frame.minY), frame.maxY - petSize.height)
    )
  }

  private func savePlacement() {
    UserDefaults.standard.set([panel.frame.origin.x, panel.frame.origin.y], forKey: "petOrigin")
    UserDefaults.standard.set([petSize.width, petSize.height], forKey: "petSize")
  }

  private func load() {
    retryWork?.cancel()
    pageReady = false
    webView.load(URLRequest(url: petURL))
  }

  private func retrySoon() {
    retryWork?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.load() }
    retryWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: work)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    pageReady = true
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    pageReady = false
    retrySoon()
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    pageReady = false
    retrySoon()
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    switch type {
    case "dragStart":
      dragOrigin = panel.frame.origin
    case "dragMove":
      let dx = body["dx"] as? Double ?? 0
      let dy = body["dy"] as? Double ?? 0
      panel.setFrameOrigin(NSPoint(x: dragOrigin.x + dx, y: dragOrigin.y - dy))
    case "dragEnd":
      savePlacement()
    case "resize":
      let width = body["width"] as? Double ?? petSize.width
      let height = body["height"] as? Double ?? petSize.height
      resizePanel(to: NSSize(width: width, height: height))
    case "hide":
      hidePanel()
    case "menu":
      let x = body["x"] as? Double ?? 0
      let y = body["y"] as? Double ?? 0
      let height = panel.contentView?.bounds.height ?? petSize.height
      showContextMenu(at: NSPoint(x: x, y: height - y))
    case "status":
      updateStatusItem(
        phase: body["phase"] as? String,
        label: body["label"] as? String,
        time: body["time"] as? String
      )
    default:
      break
    }
  }

  private func writePid() {
    try? FileManager.default.createDirectory(
      atPath: (pidPath as NSString).deletingLastPathComponent,
      withIntermediateDirectories: true
    )
    try? "\(ProcessInfo.processInfo.processIdentifier)\n".write(toFile: pidPath, atomically: true, encoding: .utf8)
  }

  private func installSignals() {
    signal(SIGUSR2, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: SIGUSR2, queue: .main)
    source.setEventHandler { [weak self] in
      guard let self else { return }
      self.showPanel()
      if !self.pageReady { self.load() }
    }
    source.resume()
    signalSource = source

    signal(SIGUSR1, SIG_IGN)
    let hideSource = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
    hideSource.setEventHandler { [weak self] in
      self?.hidePanel()
    }
    hideSource.resume()
    hideSignalSource = hideSource

    for sig in [SIGTERM, SIGINT] {
      signal(sig, SIG_IGN)
      let term = DispatchSource.makeSignalSource(signal: sig, queue: .main)
      term.setEventHandler {
        try? FileManager.default.removeItem(atPath: pidPath)
        NSApp.terminate(nil)
      }
      term.resume()
      terminationSources.append(term)
    }
  }

  func applicationWillTerminate(_ notification: Notification) {
    if let rightClickDownMonitor {
      NSEvent.removeMonitor(rightClickDownMonitor)
      self.rightClickDownMonitor = nil
    }
    if let rightClickUpMonitor {
      NSEvent.removeMonitor(rightClickUpMonitor)
      self.rightClickUpMonitor = nil
    }
    try? FileManager.default.removeItem(atPath: pidPath)
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
