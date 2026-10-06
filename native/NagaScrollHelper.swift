import ApplicationServices
import Foundation

private func negate(_ event: CGEvent, _ field: CGEventField) {
    let value = event.getIntegerValueField(field)
    if value != 0 {
        event.setIntegerValueField(field, value: -value)
    }
}

private let callback: CGEventTapCallBack = { _, type, event, _ in
    guard type == .scrollWheel else {
        return Unmanaged.passUnretained(event)
    }

    let continuous = event.getIntegerValueField(.scrollWheelEventIsContinuous)
    if continuous != 0 {
        return Unmanaged.passUnretained(event)
    }

    negate(event, .scrollWheelEventDeltaAxis1)
    negate(event, .scrollWheelEventPointDeltaAxis1)
    negate(event, .scrollWheelEventFixedPtDeltaAxis1)

    return Unmanaged.passUnretained(event)
}

let mask = CGEventMask(1 << CGEventType.scrollWheel.rawValue)

guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .defaultTap,
    eventsOfInterest: mask,
    callback: callback,
    userInfo: nil
) else {
    fputs("Naga scroll helper requires Accessibility permission.\n", stderr)
    exit(2)
}

guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
    fputs("Unable to create Naga scroll helper run-loop source.\n", stderr)
    exit(3)
}

CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
CFRunLoopRun()
