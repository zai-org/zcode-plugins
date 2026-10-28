import AppKit
import Combine
import SwiftUI

final class XiaoqiPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private func visibleFrame(containing point: NSPoint) -> NSRect {
    NSScreen.screens.first(where: { $0.frame.contains(point) })?.visibleFrame
        ?? NSScreen.main?.visibleFrame
        ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
}

private func clampOrigin(_ origin: NSPoint, size: NSSize, within frame: NSRect) -> NSPoint {
    NSPoint(
        x: min(max(origin.x, frame.minX + 8), max(frame.minX + 8, frame.maxX - size.width - 8)),
        y: min(max(origin.y, frame.minY + 8), max(frame.minY + 8, frame.maxY - size.height - 8))
    )
}

final class PetWindowController {
    let model: PetModel
    let panel: XiaoqiPanel
    var onFrameChanged: ((NSRect) -> Void)?

    private var dragStartOrigin = NSPoint.zero
    private var dragStartMouse = NSPoint.zero
    private var dragging = false

    private static let xKey = "xiaoqi.pet.x"
    private static let yKey = "xiaoqi.pet.y"

    init(model: PetModel) {
        self.model = model
        panel = XiaoqiPanel(
            contentRect: NSRect(x: 0, y: 0, width: 164, height: 186),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isMovableByWindowBackground = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.isRestorable = false
        panel.acceptsMouseMovedEvents = true
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true

        let view = PetStageView(
            model: model,
            onToggleBoard: { [weak model] in model?.boardOpen.toggle() },
            onToggleLock: { [weak model] in model?.toggleLock() },
            onBeginDrag: { [weak self] in self?.beginDrag() },
            onDrag: { [weak self] in self?.drag() },
            onEndDrag: { [weak self] in self?.endDrag() }
        )
        panel.contentView = NSHostingView(rootView: view)

        let defaults = UserDefaults.standard
        let size = panel.frame.size
        var origin: NSPoint
        if defaults.object(forKey: Self.xKey) != nil, defaults.object(forKey: Self.yKey) != nil {
            origin = NSPoint(
                x: defaults.double(forKey: Self.xKey),
                y: defaults.double(forKey: Self.yKey)
            )
        } else {
            let frame = NSScreen.main?.visibleFrame ?? visibleFrame(containing: .zero)
            origin = NSPoint(x: frame.minX + 38, y: frame.minY + 74)
        }
        let screen = visibleFrame(containing: NSPoint(x: origin.x + size.width / 2, y: origin.y + size.height / 2))
        panel.setFrameOrigin(clampOrigin(origin, size: size, within: screen))
    }

    var isVisible: Bool { panel.isVisible }

    func show() {
        panel.orderFrontRegardless()
    }

    func hide() {
        panel.orderOut(nil)
    }

    func toggle() {
        panel.isVisible ? hide() : show()
    }

    func beginDrag() {
        guard !model.locked else { return }
        dragging = true
        dragStartOrigin = panel.frame.origin
        dragStartMouse = NSEvent.mouseLocation
    }

    func drag() {
        guard dragging, !model.locked else { return }
        let mouse = NSEvent.mouseLocation
        let next = NSPoint(
            x: dragStartOrigin.x + mouse.x - dragStartMouse.x,
            y: dragStartOrigin.y + mouse.y - dragStartMouse.y
        )
        let screen = visibleFrame(containing: NSPoint(x: mouse.x, y: mouse.y))
        panel.setFrameOrigin(clampOrigin(next, size: panel.frame.size, within: screen))
        onFrameChanged?(panel.frame)
    }

    func endDrag() {
        guard dragging else { return }
        dragging = false
        let origin = panel.frame.origin
        UserDefaults.standard.set(origin.x, forKey: Self.xKey)
        UserDefaults.standard.set(origin.y, forKey: Self.yKey)
        onFrameChanged?(panel.frame)
    }
}

final class BoardWindowController {
    let model: PetModel
    let panel: XiaoqiPanel
    private var cancellable: AnyCancellable?
    private var tasksCancellable: AnyCancellable?
    private weak var petController: PetWindowController?

    init(model: PetModel, petController: PetWindowController) {
        self.model = model
        self.petController = petController
        panel = XiaoqiPanel(
            contentRect: NSRect(x: 0, y: 0, width: 368, height: 530),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.isRestorable = false

        let view = BoardView(
            model: model,
            onClose: { [weak model] in model?.boardOpen = false },
            onToggleLock: { [weak model] in model?.toggleLock() },
            onOpenTask: { [weak model] _ in
                model?.activateZCode()
                model?.boardOpen = false
            }
        )
        panel.contentView = NSHostingView(rootView: view)

        cancellable = model.$boardOpen
            .removeDuplicates()
            .sink { [weak self] open in
                guard let self else { return }
                if open {
                    self.resizeForContent()
                    self.reposition(near: self.petController?.panel.frame)
                    self.panel.orderFrontRegardless()
                } else {
                    self.panel.orderOut(nil)
                }
            }

        tasksCancellable = model.$tasks
            .removeDuplicates()
            .sink { [weak self] _ in
                guard let self, self.model.boardOpen else { return }
                self.resizeForContent()
                self.reposition(near: self.petController?.panel.frame)
            }
    }

    private func resizeForContent() {
        let groups = [model.waiting, model.running, model.done].filter { !$0.isEmpty }
        let desired: CGFloat
        if groups.isEmpty {
            desired = 378
        } else {
            var height: CGFloat = 112
            for group in groups {
                height += 26
                for task in group {
                    let hasProgress = task.progress != nil && (task.kind == "running" || task.kind == "waiting")
                    height += hasProgress ? 136 : 54
                }
            }
            height += CGFloat(max(0, groups.count - 1)) * 4
            desired = min(530, max(300, height))
        }
        panel.setContentSize(NSSize(width: 368, height: desired))
    }

    func reposition(near petFrame: NSRect?) {
        guard let pet = petFrame ?? petController?.panel.frame else { return }
        let screen = visibleFrame(containing: NSPoint(x: pet.midX, y: pet.midY))
        let size = panel.frame.size
        var x = pet.maxX + 12
        if x + size.width > screen.maxX - 8 {
            x = pet.minX - size.width - 12
        }
        if x < screen.minX + 8 {
            x = min(max(screen.minX + 8, pet.midX - size.width / 2), screen.maxX - size.width - 8)
        }
        var y = pet.midY - size.height * 0.55
        y = min(max(y, screen.minY + 8), screen.maxY - size.height - 8)
        panel.setFrameOrigin(NSPoint(x: x, y: y))
    }
}

final class DrawerWindowController {
    let model: PetModel
    let panel: XiaoqiPanel
    private weak var petController: PetWindowController?
    private var tasksCancellable: AnyCancellable?
    private var boardCancellable: AnyCancellable?
    private var fadingOut = false

    init(model: PetModel, petController: PetWindowController) {
        self.model = model
        self.petController = petController
        panel = XiaoqiPanel(
            contentRect: NSRect(x: 0, y: 0, width: 332, height: 220),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.isRestorable = false

        panel.contentView = NSHostingView(rootView: TaskDrawerView(
            model: model,
            onOpen: { [weak model] _ in
                model?.activateZCode()
            }
        ))

        tasksCancellable = model.$tasks
            .removeDuplicates()
            .sink { [weak self] _ in self?.refresh() }
        boardCancellable = model.$boardOpen
            .removeDuplicates()
            .sink { [weak self] _ in self?.refresh() }
        refresh(animated: false)
    }

    func petVisibilityChanged() {
        refresh(animated: false)
    }

    func reposition(near petFrame: NSRect?) {
        guard panel.isVisible else { return }
        panel.setFrameOrigin(targetOrigin(for: panel.frame.size, petFrame: petFrame))
    }

    private func desiredHeight() -> CGFloat {
        let count = min(model.tasks.count, 4)
        var height: CGFloat = 24 + CGFloat(count) * 96 + CGFloat(max(0, count - 1)) * 6
        if model.tasks.count > 4 { height += 22 }
        return height
    }

    private func refresh(animated: Bool = true) {
        guard !model.boardOpen, model.tasks.count >= 2, petController?.isVisible == true else {
            hide()
            return
        }
        let size = NSSize(width: 332, height: desiredHeight())
        panel.setContentSize(size)
        let target = targetOrigin(for: size, petFrame: petController?.panel.frame)
        if panel.isVisible {
            panel.alphaValue = 1
            panel.setFrameOrigin(target)
            return
        }
        let start = NSPoint(x: target.x - 16, y: target.y)
        panel.setFrameOrigin(start)
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.22
                panel.animator().alphaValue = 1
            }
        } else {
            panel.alphaValue = 1
        }
        panel.setFrameOrigin(target)
    }

    private func targetOrigin(for size: NSSize, petFrame: NSRect?) -> NSPoint {
        guard let pet = petFrame ?? petController?.panel.frame else { return NSPoint(x: 0, y: 0) }
        let screen = visibleFrame(containing: NSPoint(x: pet.midX, y: pet.midY))
        var x = pet.maxX + 12
        if x + size.width > screen.maxX - 8 {
            x = pet.minX - size.width - 12
        }
        x = min(max(x, screen.minX + 8), screen.maxX - size.width - 8)
        var y = pet.midY - size.height / 2
        y = min(max(y, screen.minY + 8), screen.maxY - size.height - 8)
        return NSPoint(x: x, y: y)
    }

    private func hide() {
        guard panel.isVisible, !fadingOut else { return }
        fadingOut = true
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.15
            panel.animator().alphaValue = 0
        } completionHandler: { [weak self] in
            guard let self else { return }
            self.panel.orderOut(nil)
            self.panel.alphaValue = 1
            self.fadingOut = false
        }
    }
}

final class BubbleWindowController {
    let model: PetModel
    let panel: XiaoqiPanel
    private weak var petController: PetWindowController?
    private var tasksCancellable: AnyCancellable?
    private var fadingOut = false

    init(model: PetModel, petController: PetWindowController) {
        self.model = model
        self.petController = petController
        panel = XiaoqiPanel(
            contentRect: NSRect(x: 0, y: 0, width: 244, height: 66),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.isRestorable = false
        panel.ignoresMouseEvents = true
        panel.contentView = NSHostingView(rootView: TaskBubbleFanView(model: model))
        tasksCancellable = model.$tasks
            .removeDuplicates()
            .sink { [weak self] _ in self?.refresh() }
        refresh(animated: false)
    }

    func petVisibilityChanged() {
        refresh(animated: false)
    }

    func reposition(near petFrame: NSRect?) {
        guard panel.isVisible else { return }
        panel.setFrameOrigin(targetOrigin(for: panel.frame.size, petFrame: petFrame))
    }

    private func desiredWidth() -> CGFloat {
        let count = min(model.tasks.count, 3)
        guard count > 0 else { return 244 }
        return 20 + CGFloat(count) * 224 + CGFloat(count - 1) * 8
    }

    private func refresh(animated: Bool = true) {
        guard model.tasks.count == 1, petController?.isVisible == true else {
            hide()
            return
        }
        let size = NSSize(width: desiredWidth(), height: 66)
        panel.setContentSize(size)
        let target = targetOrigin(for: size, petFrame: petController?.panel.frame)
        if panel.isVisible {
            panel.alphaValue = 1
            panel.setFrameOrigin(target)
            return
        }
        panel.setFrameOrigin(NSPoint(x: target.x, y: target.y - 6))
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.2
                panel.animator().alphaValue = 1
            }
        } else {
            panel.alphaValue = 1
        }
        panel.setFrameOrigin(target)
    }

    private func targetOrigin(for size: NSSize, petFrame: NSRect?) -> NSPoint {
        guard let pet = petFrame ?? petController?.panel.frame else { return .zero }
        let screen = visibleFrame(containing: NSPoint(x: pet.midX, y: pet.midY))
        var x = pet.minX
        if x + size.width > screen.maxX - 8 {
            x = screen.maxX - size.width - 8
        }
        x = min(max(x, screen.minX + 8), max(screen.minX + 8, screen.maxX - size.width - 8))
        var y = pet.minY - size.height - 4
        if y < screen.minY + 4 {
            y = pet.maxY + 4
        }
        y = min(max(y, screen.minY + 8), max(screen.minY + 8, screen.maxY - size.height - 8))
        return NSPoint(x: x, y: y)
    }

    private func hide() {
        guard panel.isVisible, !fadingOut else { return }
        fadingOut = true
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.14
            panel.animator().alphaValue = 0
        } completionHandler: { [weak self] in
            guard let self else { return }
            self.panel.orderOut(nil)
            self.panel.alphaValue = 1
            self.fadingOut = false
        }
    }
}

final class NoticeWindowController {
    private let panel: XiaoqiPanel
    private var hideTimer: Timer?
    private weak var petController: PetWindowController?

    init(petController: PetWindowController) {
        self.petController = petController
        panel = XiaoqiPanel(
            contentRect: NSRect(x: 0, y: 0, width: 340, height: 108),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.isRestorable = false
        panel.ignoresMouseEvents = true
        panel.alphaValue = 0
    }

    func show(_ notice: PetNotice, near petFrame: NSRect?) {
        hideTimer?.invalidate()
        panel.contentView = NSHostingView(rootView: NoticeView(notice: notice))
        if let pet = petFrame {
            let screen = visibleFrame(containing: NSPoint(x: pet.midX, y: pet.midY))
            let size = panel.frame.size
            var x = pet.midX - size.width / 2
            x = min(max(x, screen.minX + 8), screen.maxX - size.width - 8)
            var y = pet.maxY + 8
            if y + size.height > screen.maxY - 8 {
                y = pet.minY - size.height - 8
            }
            y = min(max(y, screen.minY + 8), screen.maxY - size.height - 8)
            panel.setFrameOrigin(NSPoint(x: x, y: y))
        }
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.18
            panel.animator().alphaValue = 1
        }
        let lifetime: TimeInterval = notice.kind == "emote" ? 6 : 7
        hideTimer = Timer.scheduledTimer(withTimeInterval: lifetime, repeats: false) { [weak self] _ in
            self?.hide()
        }
    }

    func reposition(near petFrame: NSRect?) {
        guard panel.isVisible, let pet = petFrame else { return }
        let screen = visibleFrame(containing: NSPoint(x: pet.midX, y: pet.midY))
        let size = panel.frame.size
        var x = pet.midX - size.width / 2
        x = min(max(x, screen.minX + 8), screen.maxX - size.width - 8)
        var y = pet.maxY + 8
        if y + size.height > screen.maxY - 8 {
            y = pet.minY - size.height - 8
        }
        y = min(max(y, screen.minY + 8), screen.maxY - size.height - 8)
        panel.setFrameOrigin(NSPoint(x: x, y: y))
    }

    func hide() {
        hideTimer?.invalidate()
        hideTimer = nil
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.16
            panel.animator().alphaValue = 0
        } completionHandler: {
            self.panel.orderOut(nil)
        }
    }
}
