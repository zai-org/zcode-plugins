import AppKit
import Combine
import Foundation

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let model = PetModel()
    private let watcher = FeedWatcher()
    private var petWindow: PetWindowController!
    private var boardWindow: BoardWindowController!
    private var drawerWindow: DrawerWindowController!
    private var bubbleWindow: BubbleWindowController!
    private var noticeWindow: NoticeWindowController!
    private var statusItem: NSStatusItem!
    private var tickTimer: Timer?

    private var showHideItem: NSMenuItem!
    private var boardItem: NSMenuItem!
    private var pinItem: NSMenuItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        if CommandLine.arguments.contains("--light") {
            NSApp.appearance = NSAppearance(named: .aqua)
        }
        NSWindow.allowsAutomaticWindowTabbing = false
        UserDefaults.standard.register(defaults: ["xiaoqi.pet.locked": false])

        petWindow = PetWindowController(model: model)
        boardWindow = BoardWindowController(model: model, petController: petWindow)
        drawerWindow = DrawerWindowController(model: model, petController: petWindow)
        bubbleWindow = BubbleWindowController(model: model, petController: petWindow)
        noticeWindow = NoticeWindowController(petController: petWindow)

        model.onNotice = { [weak self] notice in
            guard let self else { return }
            self.noticeWindow.show(notice, near: self.petWindow.panel.frame)
        }
        petWindow.onFrameChanged = { [weak self] frame in
            guard let self else { return }
            self.boardWindow.reposition(near: frame)
            self.drawerWindow.reposition(near: frame)
            self.bubbleWindow.reposition(near: frame)
            self.noticeWindow.reposition(near: frame)
        }

        buildStatusItem()
        petWindow.show()

        watcher.onBatch = { [weak self] events, emotes in
            self?.model.applyBatch(events, emotes)
        }
        watcher.start()
        model.refreshBalance(force: true)

        let tick = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.model.tick()
        }
        RunLoop.main.add(tick, forMode: .common)
        tickTimer = tick

        if CommandLine.arguments.contains("--board") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
                self?.model.boardOpen = true
            }
        }
        print("Xiaoqi Pet started")
    }

    func applicationWillTerminate(_ notification: Notification) {
        watcher.stop()
        tickTimer?.invalidate()
        if let statusItem {
            NSStatusBar.system.removeStatusItem(statusItem)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "pawprint.fill", accessibilityDescription: "Xiaoqi")
            button.image?.isTemplate = true
            button.toolTip = L10n.text("Xiaoqi desktop companion", "小栖桌宠")
        }
        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.delegate = self

        showHideItem = NSMenuItem(title: "", action: #selector(togglePetVisibility), keyEquivalent: "")
        showHideItem.target = self
        menu.addItem(showHideItem)

        boardItem = NSMenuItem(title: "", action: #selector(toggleBoardFromMenu), keyEquivalent: "")
        boardItem.target = self
        menu.addItem(boardItem)

        pinItem = NSMenuItem(title: "", action: #selector(togglePinFromMenu), keyEquivalent: "")
        pinItem.target = self
        menu.addItem(pinItem)

        menu.addItem(.separator())

        let rescan = NSMenuItem(title: L10n.text("Rescan events", "重新扫描事件"), action: #selector(rescan), keyEquivalent: "r")
        rescan.target = self
        menu.addItem(rescan)

        let refreshBalance = NSMenuItem(title: L10n.text("Refresh usage / balance", "刷新用量 / 余量"), action: #selector(refreshBalanceFromMenu), keyEquivalent: "b")
        refreshBalance.target = self
        menu.addItem(refreshBalance)

        let quit = NSMenuItem(title: L10n.text("Quit Xiaoqi", "退出小栖"), action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        statusItem.menu = menu
        menuWillOpen(menu)
    }

    func menuWillOpen(_ menu: NSMenu) {
        showHideItem.title = petWindow.isVisible
            ? L10n.text("Hide Xiaoqi", "隐藏小栖")
            : L10n.text("Show Xiaoqi", "显示小栖")
        boardItem.title = model.boardOpen
            ? L10n.text("Close task board", "收起任务看板")
            : L10n.text("Open task board", "打开任务看板")
        pinItem.title = model.locked
            ? L10n.text("Unpin position", "解除固定")
            : L10n.text("Pin position", "固定位置")
        pinItem.state = model.locked ? .on : .off
    }

    @objc private func togglePetVisibility() {
        if petWindow.isVisible {
            model.boardOpen = false
            noticeWindow.hide()
            petWindow.hide()
            drawerWindow.petVisibilityChanged()
            bubbleWindow.petVisibilityChanged()
        } else {
            petWindow.show()
            drawerWindow.petVisibilityChanged()
            bubbleWindow.petVisibilityChanged()
        }
    }

    @objc private func toggleBoardFromMenu() {
        if !petWindow.isVisible { petWindow.show() }
        model.boardOpen.toggle()
        if model.boardOpen {
            boardWindow.reposition(near: petWindow.panel.frame)
        }
    }

    @objc private func togglePinFromMenu() {
        model.toggleLock()
    }

    @objc private func rescan() {
        watcher.scan()
    }

    @objc private func refreshBalanceFromMenu() {
        model.refreshBalance(force: true)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}
