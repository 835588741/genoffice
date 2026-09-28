import AppKit
import AuthenticationServices
import Darwin
import Foundation

final class PresentationContext: NSObject,
    ASWebAuthenticationPresentationContextProviding,
    ASAuthorizationControllerPresentationContextProviding {
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

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        window
    }
}

final class AppleAuthorizationDelegate: NSObject, ASAuthorizationControllerDelegate {
    private let lock = NSLock()
    private(set) var credential: ASAuthorizationAppleIDCredential?
    private(set) var callbackError: Error?

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        lock.lock()
        credential = authorization.credential as? ASAuthorizationAppleIDCredential
        if credential == nil {
            callbackError = NSError(domain: "AiOfficeAppleAuth", code: 1)
        }
        lock.unlock()
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        let details = error as NSError
        fputs(
            "Apple authorization failed: \(details.domain) (\(details.code)) \(details.localizedDescription)\n",
            stderr
        )
        lock.lock()
        callbackError = error
        lock.unlock()
    }

    func snapshot() -> (ASAuthorizationAppleIDCredential?, Error?) {
        lock.lock()
        defer { lock.unlock() }
        return (credential, callbackError)
    }
}

func activateApplication() {
    let application = NSApplication.shared
    // ASAuthorizationController presents a system sheet over this anchor. An
    // accessory app can leave that sheet behind another application's window,
    // which looks like a stalled login to the user.
    application.setActivationPolicy(.regular)
    application.activate(ignoringOtherApps: true)
}

func runWebAuthentication(loginURL: URL, callbackScheme: String) {
    activateApplication()
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
}

func runAppleAuthentication(nonceHash: String) {
    guard !nonceHash.isEmpty else {
        fputs("invalid Apple nonce\n", stderr)
        exit(64)
    }

    activateApplication()
    let context = PresentationContext()
    let delegate = AppleAuthorizationDelegate()
    let request = ASAuthorizationAppleIDProvider().createRequest()
    request.requestedScopes = [.fullName, .email]
    request.nonce = nonceHash
    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = delegate
    controller.presentationContextProvider = context
    controller.performRequests()

    while true {
        let (credential, error) = delegate.snapshot()
        if let credential {
            guard let identityToken = credential.identityToken,
                  !identityToken.isEmpty else {
                fputs("Apple did not return an identity token\n", stderr)
                exit(1)
            }

            var payload: [String: Any] = [
                "user": credential.user,
                "identityToken": identityToken.base64EncodedString(),
            ]
            if let authorizationCode = credential.authorizationCode {
                payload["authorizationCode"] = authorizationCode.base64EncodedString()
            }
            if let email = credential.email {
                payload["email"] = email
            }
            if let givenName = credential.fullName?.givenName {
                payload["givenName"] = givenName
            }
            if let familyName = credential.fullName?.familyName {
                payload["familyName"] = familyName
            }

            guard let json = try? JSONSerialization.data(withJSONObject: payload) else {
                fputs("Apple credential encoding failed\n", stderr)
                exit(1)
            }
            print("APPLE\t\(json.base64EncodedString())")
            fflush(stdout)
            exit(0)
        }
        if error != nil {
            fputs("Apple authorization was cancelled or failed\n", stderr)
            exit(1)
        }
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
    }
}

if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "apple" {
    runAppleAuthentication(nonceHash: CommandLine.arguments[2])
}

guard CommandLine.arguments.count == 3,
      let loginURL = URL(string: CommandLine.arguments[1]),
      !CommandLine.arguments[2].isEmpty else {
    fputs("invalid authentication session arguments\n", stderr)
    exit(64)
}
runWebAuthentication(loginURL: loginURL, callbackScheme: CommandLine.arguments[2])
