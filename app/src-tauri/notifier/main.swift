// bismuth-notify <title> <body> — posts one desktop notification under Bismuth's own identity.
//
// Shipped as a Tauri externalBin, so it sits in Bismuth.app/Contents/MacOS beside the app's main
// executable. A process there resolves Bundle.main to Bismuth.app, which is what makes macOS show
// the notification with the Bismuth name and icon and file it under Bismuth in System Settings
// (osascript's `display notification` always shows Script Editor's). The daemon finds this binary
// through ~/.bismuth/notifier (written by core/src/notifierPointer.ts) and runs it per notice.
//
// Exit codes: 0 posted · 2 the user turned Bismuth notifications off (callers must not fall back
// to another channel) · 1 anything else (callers fall back to osascript).
import Foundation
import UserNotifications

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: bismuth-notify <title> <body>\n".data(using: .utf8)!)
    exit(1)
}

let center = UNUserNotificationCenter.current()
let done = DispatchSemaphore(value: 0)
var code: Int32 = 1

// The first call asks the user once; later calls return the stored answer immediately.
center.requestAuthorization(options: [.alert]) { granted, err in
    guard granted else {
        if let err { FileHandle.standardError.write("bismuth-notify: \(err)\n".data(using: .utf8)!) }
        code = 2
        done.signal()
        return
    }
    let content = UNMutableNotificationContent()
    content.title = args[1]
    content.body = args[2]
    let request = UNNotificationRequest(
        identifier: UUID().uuidString, content: content, trigger: nil)
    center.add(request) { err in
        if let err { FileHandle.standardError.write("bismuth-notify: \(err)\n".data(using: .utf8)!) }
        code = err == nil ? 0 : 1
        done.signal()
    }
}

// The first run waits on the permission prompt. Exiting while it is still up gets the app recorded
// as not allowed, which silences every later notice, so wait out a user who is away from the
// screen. The daemon spawns this without awaiting it, so the wait blocks nothing.
if done.wait(timeout: .now() + 6 * 60 * 60) == .timedOut { exit(1) }
exit(code)
