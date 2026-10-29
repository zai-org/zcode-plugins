import AppKit
import Foundation

if CommandLine.arguments.contains("--diagnose") {
    print(XiaoqiDiagnose.run())
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
