import Cocoa
import ApplicationServices

private final class AutoscrollIndicatorView: NSView {
  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)

    let circle = NSBezierPath(ovalIn: bounds.insetBy(dx: 2, dy: 2))
    NSColor(calibratedWhite: 0.08, alpha: 0.88).setFill()
    circle.fill()

    NSColor(calibratedWhite: 1.0, alpha: 0.9).setStroke()
    circle.lineWidth = 1.4
    circle.stroke()

    let midX = bounds.midX
    let midY = bounds.midY
    let line = NSBezierPath()
    line.move(to: NSPoint(x: midX, y: 9))
    line.line(to: NSPoint(x: midX, y: bounds.height - 9))
    line.lineWidth = 1.6
    line.stroke()

    let up = NSBezierPath()
    up.move(to: NSPoint(x: midX, y: bounds.height - 7))
    up.line(to: NSPoint(x: midX - 4, y: bounds.height - 12))
    up.move(to: NSPoint(x: midX, y: bounds.height - 7))
    up.line(to: NSPoint(x: midX + 4, y: bounds.height - 12))
    up.lineWidth = 1.6
    up.stroke()

    let down = NSBezierPath()
    down.move(to: NSPoint(x: midX, y: 7))
    down.line(to: NSPoint(x: midX - 4, y: 12))
    down.move(to: NSPoint(x: midX, y: 7))
    down.line(to: NSPoint(x: midX + 4, y: 12))
    down.lineWidth = 1.6
    down.stroke()

    let center = NSBezierPath(ovalIn: NSRect(x: midX - 2, y: midY - 2, width: 4, height: 4))
    NSColor.white.setFill()
    center.fill()
  }
}

private final class AutoscrollController {
  private let browserBundleIds: Set<String> = [
    "com.apple.safari",
    "com.google.chrome",
    "com.google.chrome.canary",
    "org.mozilla.firefox",
    "com.microsoft.edgemac",
    "com.brave.browser",
    "company.thebrowser.browser",
    "company.thebrowser.dia",
    "com.operasoftware.opera",
    "com.vivaldi.vivaldi",
  ]

  private var eventTap: CFMachPort?
  private var eventSource: CFRunLoopSource?
  private var timer: Timer?
  private var overlay: NSWindow?
  private var anchor = NSPoint.zero
  private var active = false
  private var swallowMiddleUp = false
  private var browserCheckTicks = 0

  private let deadZone: CGFloat = 20
  private let maxPixelsPerTick: Double = 72

  func start() -> Bool {
    let mask =
      CGEventMask(1 << CGEventType.otherMouseDown.rawValue) |
      CGEventMask(1 << CGEventType.otherMouseUp.rawValue) |
      CGEventMask(1 << CGEventType.leftMouseDown.rawValue) |
      CGEventMask(1 << CGEventType.rightMouseDown.rawValue) |
      CGEventMask(1 << CGEventType.keyDown.rawValue)

    let opaqueSelf = Unmanaged.passUnretained(self).toOpaque()
    guard let tap = CGEvent.tapCreate(
      tap: .cgSessionEventTap,
      place: .headInsertEventTap,
      options: .defaultTap,
      eventsOfInterest: mask,
      callback: autoscrollEventCallback,
      userInfo: opaqueSelf
    ) else {
      fputs("[autoscroll] unable to create event tap; Accessibility permission is required\n", stderr)
      return false
    }

    eventTap = tap
    eventSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    if let eventSource {
      CFRunLoopAddSource(CFRunLoopGetMain(), eventSource, .commonModes)
    }
    CGEvent.tapEnable(tap: tap, enable: true)
    return true
  }

  func handle(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      if let eventTap {
        CGEvent.tapEnable(tap: eventTap, enable: true)
      }
      return Unmanaged.passUnretained(event)
    }

    switch type {
    case .otherMouseDown:
      let button = event.getIntegerValueField(.mouseEventButtonNumber)
      guard button == 2 else { return Unmanaged.passUnretained(event) }

      if active {
        deactivate()
        swallowMiddleUp = true
        return nil
      }

      guard isSupportedBrowserFrontmost() else {
        return Unmanaged.passUnretained(event)
      }

      activate()
      swallowMiddleUp = true
      return nil

    case .otherMouseUp:
      let button = event.getIntegerValueField(.mouseEventButtonNumber)
      if button == 2 && swallowMiddleUp {
        swallowMiddleUp = false
        return nil
      }
      return Unmanaged.passUnretained(event)

    case .leftMouseDown, .rightMouseDown:
      if active { deactivate() }
      return Unmanaged.passUnretained(event)

    case .keyDown:
      if active && event.getIntegerValueField(.keyboardEventKeycode) == 53 {
        deactivate()
        return nil
      }
      return Unmanaged.passUnretained(event)

    default:
      return Unmanaged.passUnretained(event)
    }
  }

  private func activate() {
    active = true
    browserCheckTicks = 0
    anchor = NSEvent.mouseLocation
    showOverlay(at: anchor)

    timer?.invalidate()
    let nextTimer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
      self?.tick()
    }
    timer = nextTimer
    RunLoop.main.add(nextTimer, forMode: .common)
  }

  private func deactivate() {
    active = false
    timer?.invalidate()
    timer = nil
    overlay?.orderOut(nil)
    overlay = nil
  }

  private func tick() {
    guard active else { return }

    browserCheckTicks += 1
    if browserCheckTicks >= 12 {
      browserCheckTicks = 0
      if !isSupportedBrowserFrontmost() {
        deactivate()
        return
      }
    }

    let current = NSEvent.mouseLocation
    let delta = current.y - anchor.y
    guard abs(delta) > deadZone else { return }

    let outside = abs(delta) - deadZone
    let accelerated = min(maxPixelsPerTick, pow(Double(outside) / 18.0, 1.35) * 2.5)
    let wheel = Int32(delta > 0 ? accelerated : -accelerated)
    guard wheel != 0 else { return }

    guard let scroll = CGEvent(
      scrollWheelEvent2Source: nil,
      units: .pixel,
      wheelCount: 1,
      wheel1: wheel,
      wheel2: 0,
      wheel3: 0
    ) else { return }

    scroll.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
    scroll.post(tap: .cghidEventTap)
  }

  private func isSupportedBrowserFrontmost() -> Bool {
    guard let bundleId = NSWorkspace.shared.frontmostApplication?.bundleIdentifier?.lowercased() else {
      return false
    }
    return browserBundleIds.contains(bundleId)
  }

  private func showOverlay(at point: NSPoint) {
    let size: CGFloat = 36
    let frame = NSRect(
      x: point.x - size / 2,
      y: point.y - size / 2,
      width: size,
      height: size
    )

    let window = NSWindow(
      contentRect: frame,
      styleMask: [.borderless],
      backing: .buffered,
      defer: false
    )
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = true
    window.ignoresMouseEvents = true
    window.level = .statusBar
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    window.contentView = AutoscrollIndicatorView(frame: NSRect(origin: .zero, size: frame.size))
    window.orderFrontRegardless()
    overlay = window
  }
}

private func autoscrollEventCallback(
  proxy: CGEventTapProxy,
  type: CGEventType,
  event: CGEvent,
  userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
  guard let userInfo else { return Unmanaged.passUnretained(event) }
  let controller = Unmanaged<AutoscrollController>.fromOpaque(userInfo).takeUnretainedValue()
  return controller.handle(type: type, event: event)
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let controller = AutoscrollController()
if !controller.start() {
  exit(2)
}
app.run()
