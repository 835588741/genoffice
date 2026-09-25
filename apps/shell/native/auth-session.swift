import AppKit
import AuthenticationServices
import Darwin
import Foundation

final class PresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding {
    private let window: NSWindow

    override init() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1, height: 1),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.alphaValue = 0
        window.ignoresMouseEvents = true
        window.level = .floating
        super.init()
        window.makeKeyAndOrderFront(nil)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        window
    }
}

guard CommandLine.arguments.count == 3,
      let loginURL = URL(string: CommandLine.arguments[1]),
      !CommandLine.arguments[2].isEmpty else {
    fputs("invalid authentication session arguments\n", stderr)
    exit(64)
}

let callbackScheme = CommandLine.arguments[2]
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
application.activate(ignoringOtherApps: true)
let context = PresentationContext()
let resultLock = NSLock()
var callbackURL: URL?
var callbackError: Error?

let session = ASWebAuthenticationSession(
    url: loginURL,
    callbackURLScheme: callbackScheme
) { url, error in
    resultLock.lock()
    callbackURL = url
    callbackError = error
    resultLock.unlock()
}
session.presentationContextProvider = context
session.prefersEphemeralWebBrowserSession = false

guard session.start() else {
    fputs("unable to start authentication session\n", stderr)
    exit(69)
}

while true {
    resultLock.lock()
    let finished = callbackURL != nil || callbackError != nil
    let url = callbackURL
    let error = callbackError
    resultLock.unlock()

    if finished {
        if let url {
            print("CALLBACK\t\(url.absoluteString)")
            fflush(stdout)
            exit(0)
        }
        if error is ASWebAuthenticationSessionError {
            fputs("authentication session cancelled or failed\n", stderr)
        } else {
            fputs("authentication session failed\n", stderr)
        }
        exit(1)
    }
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
}
