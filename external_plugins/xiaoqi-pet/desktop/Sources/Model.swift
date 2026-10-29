import AppKit
import Combine
import Foundation
import SQLite3

enum L10n {
    static let isChinese = Locale.preferredLanguages.first?.lowercased().hasPrefix("zh") ?? false

    static func text(_ en: String, _ zh: String) -> String {
        isChinese ? zh : en
    }

    static func status(_ task: RemoteTask) -> String {
        switch task.kind {
        case "waiting": return text("Needs you", "需要你")
        case "running": return text("Running", "进行中")
        case "done": return text("Done", "已完成")
        default: return ""
        }
    }

    static func pending(kind: String?, tool: String?) -> String {
        switch kind ?? "" {
        case "approval":
            if let tool, !tool.isEmpty {
                return text("Waiting for approval · \(tool)", "等待确认 · \(tool)")
            }
            return text("Waiting for tool approval", "等待确认工具调用")
        case "question":
            return text("Waiting for your answer", "等待你回答问题")
        default:
            return text("Waiting for you", "等待你处理")
        }
    }

    static func relative(_ milliseconds: Double) -> String {
        guard milliseconds > 0 else { return "" }
        let date = Date(timeIntervalSince1970: milliseconds / 1000)
        let delta = max(0, Date().timeIntervalSince(date))
        if delta < 60 { return text("just now", "刚刚") }
        if delta < 3600 {
            let minutes = max(1, Int(delta / 60))
            return text("\(minutes) min ago", "\(minutes) 分钟前")
        }
        if delta < 86_400 {
            let hours = max(1, Int(delta / 3600))
            return text("\(hours) h ago", "\(hours) 小时前")
        }
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    static func taskMeta(_ task: RemoteTask) -> String {
        var parts: [String] = []
        if !task.project.isEmpty { parts.append(task.project) }
        switch task.kind {
        case "waiting":
            parts.append(pending(kind: task.pendingKind, tool: task.pendingTool))
        case "running":
            parts.append(text("Working", "正在处理"))
        case "done":
            parts.append(text("Completed", "已完成"))
        default:
            break
        }
        if task.kind != "running" || task.progress == nil {
            let age = relative(task.updatedAt)
            if !age.isEmpty { parts.append(age) }
        }
        return parts.joined(separator: " · ")
    }

    static func phase(_ phase: String) -> String {
        switch phase {
        case "thinking": return text("Thinking", "思考中")
        case "tool": return text("Running a tool", "执行工具中")
        case "responding": return text("Writing the answer", "生成回复中")
        case "done": return text("Finished", "已完成")
        default: return text("Preparing", "准备中")
        }
    }

    static func phasePrimary(_ progress: RemoteProgress) -> String {
        switch progress.phase {
        case "tool":
            let tool = progress.tool ?? ""
            return tool.isEmpty
                ? text("Running a tool", "执行工具中")
                : text("Running \(tool)", "正在执行 \(tool)")
        case "thinking":
            if progress.step > 0 {
                return text("Thinking · step \(progress.step)", "思考中 · 第 \(progress.step) 步")
            }
            return text("Thinking", "思考中")
        case "responding": return text("Writing the answer", "生成回复中")
        case "done": return text("Finished", "已完成")
        default: return text("Preparing", "准备中")
        }
    }

    static func phaseShort(_ progress: RemoteProgress) -> String {
        let todo = todoLine(progress)
        if !todo.isEmpty {
            return todo.count > 24 ? String(todo.prefix(23)) + "…" : todo
        }
        if let action = progress.action {
            let label = actionLabel(action)
            return label.count > 28 ? String(label.prefix(27)) + "…" : label
        }
        switch progress.phase {
        case "tool":
            let tool = progress.tool ?? ""
            if tool.isEmpty { return text("Running a tool", "执行中") }
            let short = tool.count > 12 ? String(tool.prefix(11)) + "…" : tool
            return text("Running \(short)", "执行 \(short)")
        case "thinking":
            return progress.step > 0
                ? text("Thinking · step \(progress.step)", "思考 · 第\(progress.step)步")
                : text("Thinking", "思考中")
        case "responding": return text("Writing", "生成回复")
        case "done": return text("Done", "已完成")
        default: return text("Preparing", "准备中")
        }
    }

    static func elapsed(_ milliseconds: Double) -> String {
        guard milliseconds > 0 else { return "" }
        let total = Int(milliseconds / 1000)
        let minutes = total / 60
        let seconds = total % 60
        if minutes >= 60 {
            let hours = minutes / 60
            let remainder = minutes % 60
            return text("\(hours)h \(remainder)m", "\(hours) 小时 \(remainder) 分")
        }
        if minutes > 0 { return text("\(minutes)m \(seconds)s", "\(minutes) 分 \(seconds) 秒") }
        return text("\(seconds)s", "\(seconds) 秒")
    }

    static func progressDetails(_ progress: RemoteProgress) -> String {
        var parts: [String] = []
        if progress.turn > 0 { parts.append(text("turn \(progress.turn)", "第 \(progress.turn) 轮")) }
        if progress.step > 0 { parts.append(text("step \(progress.step)", "第 \(progress.step) 步")) }
        if progress.toolCount > 0 { parts.append(text("\(progress.toolCount) tools", "\(progress.toolCount) 个工具")) }
        let time = elapsed(progress.elapsedMs)
        if !time.isEmpty { parts.append(time) }
        return parts.joined(separator: " · ")
    }

    static func actionLabel(_ action: RemoteAction) -> String {
        let target = action.target
        let label: String
        switch action.kind {
        case "read": label = text("Read \(target)", "读取 \(target)")
        case "write": label = text("Write \(target)", "写入 \(target)")
        case "edit": label = text("Edit \(target)", "修改 \(target)")
        case "bash": label = text("Run: \(target)", "运行：\(target)")
        case "glob": label = text("Find \(target)", "查找 \(target)")
        case "grep": label = text("Search \(target)", "搜索 \(target)")
        case "image": label = text("View \(target)", "查看 \(target)")
        case "search": label = text("Search web: \(target)", "检索：\(target)")
        case "fetch": label = text("Fetch: \(target)", "读取网页：\(target)")
        case "subagent": label = text("Delegate: \(target)", "调度子任务：\(target)")
        case "workflow": label = text("Workflow: \(target)", "运行工作流：\(target)")
        case "skill": label = text("Skill: \(target)", "加载技能：\(target)")
        case "todo": label = text("Update checklist", "更新任务清单")
        case "schedule": label = text("Schedule: \(target)", "定时任务：\(target)")
        case "question": label = text("Ask: \(target)", "提问：\(target)")
        case "plan": label = text("Planning", "整理计划")
        case "mcp": label = target.isEmpty ? text("MCP tool", "调用 MCP 工具") : text("MCP: \(target)", "MCP：\(target)")
        default: label = target.isEmpty ? text("Use a tool", "调用工具") : text("Use \(target)", "调用 \(target)")
        }
        if action.done == true {
            return action.failed == true ? "\(label) ✗" : "\(label) ✓"
        }
        return label
    }

    static func actionLine(_ progress: RemoteProgress) -> String {
        if let action = progress.action { return actionLabel(action) }
        return phase(progress.phase)
    }

    static func todoLine(_ progress: RemoteProgress) -> String {
        guard let todos = progress.todos, todos.total > 0 else { return "" }
        if !todos.current.isEmpty { return todos.current }
        if todos.completed >= todos.total { return text("Checklist complete", "任务清单已完成") }
        return ""
    }

    static func todoCount(_ progress: RemoteProgress) -> String {
        guard let todos = progress.todos, todos.total > 0 else { return "" }
        return text("\(todos.completed)/\(todos.total) done", "\(todos.completed)/\(todos.total) 项")
    }

    static func trail(_ progress: RemoteProgress) -> String {
        progress.trail.suffix(3).map { item in
            if item.kind == "action" {
                let label = actionLabel(RemoteAction(
                    kind: item.actionKind ?? "tool",
                    target: item.label,
                    detail: nil,
                    done: item.done,
                    failed: item.failed
                ))
                return label.count > 42 ? String(label.prefix(41)) + "…" : label
            }
            switch item.kind {
            case "tool": return item.label.isEmpty ? text("tool", "工具") : item.label
            case "toolDone": return text("\(item.label) ✓", "\(item.label) ✓")
            case "thinking": return text("think", "思考")
            case "reply": return text("answer", "回复")
            case "turn": return text("start", "开始")
            default: return item.label
            }
        }.joined(separator: "  →  ")
    }
}

enum PetMood: String {
    case idle
    case running
    case waiting
    case done
}

// MARK: - 桥接状态结构（看板与抽屉共用的展示模型）

struct RemoteTrailItem: Codable, Equatable {
    let kind: String
    let label: String
    let at: Double
    let actionKind: String?
    let done: Bool?
    let failed: Bool?
}

struct RemoteAction: Codable, Equatable {
    let kind: String
    let target: String
    let detail: String?
    let done: Bool?
    let failed: Bool?
}

struct RemoteTodos: Codable, Equatable {
    let total: Int
    let completed: Int
    let current: String
}

struct RemoteProgress: Codable, Equatable {
    let phase: String
    let turn: Int
    let step: Int
    let tool: String?
    let toolCount: Int
    let elapsedMs: Double
    let updatedAt: Double
    let action: RemoteAction?
    let todos: RemoteTodos?
    let trail: [RemoteTrailItem]
}

struct RemoteTask: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let project: String
    let kind: String
    let pendingKind: String?
    let pendingTool: String?
    let current: Bool
    let updatedAt: Double
    let progress: RemoteProgress?
}

struct PetNotice: Identifiable {
    let id = UUID()
    let kind: String
    let title: String
    let body: String
}

// MARK: - Hook 事件载荷解析

enum FeedError: LocalizedError {
    case noEvents

    var errorDescription: String? {
        switch self {
        case .noEvents:
            return L10n.text(
                "No hook events yet. Install the xiaoqi-pet plugin in ZCode and run a session.",
                "还没有收到 hook 事件。请在 ZCode 安装 xiaoqi-pet 插件并运行一次会话。"
            )
        }
    }
}

/// 从 hook 的 stdin JSON（由 feed-event.sh 包装）里安全取值的工具。
private func payloadString(_ payload: [String: Any], _ keys: [String]) -> String {
    for key in keys {
        if let value = payload[key] as? String { return value }
    }
    return ""
}

private func payloadDouble(_ payload: [String: Any], _ keys: [String]) -> Double {
    for key in keys {
        if let number = payload[key] as? NSNumber { return number.doubleValue }
        if let value = payload[key] as? String, let parsed = Double(value) { return parsed }
    }
    return 0
}

private func isoToMs(_ value: String) -> Double {
    guard !value.isEmpty else { return 0 }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) {
        return date.timeIntervalSince1970 * 1000
    }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    if let date = plain.date(from: value) {
        return date.timeIntervalSince1970 * 1000
    }
    return 0
}

func parseToolArguments(_ value: Any?) -> [String: Any] {
    if let dict = value as? [String: Any] { return dict }
    if let text = value as? String, text.count <= 262_144,
       let data = text.data(using: .utf8),
       let parsed = try? JSONSerialization.jsonObject(with: data),
       let dict = parsed as? [String: Any] {
        return dict
    }
    return [:]
}

func shortText(_ value: Any?, _ max: Int) -> String {
    guard let text = value as? String else { return "" }
    let trimmed = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty { return "" }
    return trimmed.count > max ? String(trimmed.prefix(max - 1)) + "…" : trimmed
}

func firstQuery(_ value: Any?) -> String {
    if let array = value as? [Any], let first = array.first {
        return shortText(first, 80)
    }
    return shortText(value, 80)
}

private func lastSeparatorIndex(_ value: String) -> String.Index? {
    let slash = value.lastIndex(of: "/")
    let backslash = value.lastIndex(of: "\\")
    switch (slash, backslash) {
    case let (left?, right?): return max(left, right)
    case let (left?, nil): return left
    case let (nil, right?): return right
    default: return nil
    }
}

func fileBase(_ value: Any?) -> String {
    guard let text = value as? String, !text.trimmingCharacters(in: .whitespaces).isEmpty else { return "" }
    let normalized = text.replacingOccurrences(of: "[/\\\\]+$", with: "", options: .regularExpression)
    let base = lastSeparatorIndex(normalized).map { String(normalized[normalized.index(after: $0)...]) } ?? normalized
    return shortText(base, 80)
}

func projectName(_ cwd: String) -> String {
    let trimmed = cwd.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty else { return "" }
    let normalized = trimmed.replacingOccurrences(of: "[/\\\\]+$", with: "", options: .regularExpression)
    let base = lastSeparatorIndex(normalized).map { String(normalized[normalized.index(after: $0)...]) } ?? normalized
    return base.isEmpty ? normalized : base
}

/// 把 (工具名, 参数) 变成看板上的动作。与 dsh 版 actionForTool 对齐，改用 ZCode 工具名。
func actionForTool(_ rawName: String, _ args: [String: Any]) -> RemoteAction {
    let name = rawName.isEmpty ? "tool" : rawName
    switch name {
    case "Read", "ReadImage":
        return RemoteAction(kind: "read", target: fileBase(args["file_path"] ?? args["path"]), detail: nil, done: false, failed: nil)
    case "Write", "ApplyPatch", "NotebookEdit":
        return RemoteAction(kind: "write", target: fileBase(args["file_path"] ?? args["path"]), detail: nil, done: false, failed: nil)
    case "Edit", "MultiEdit":
        return RemoteAction(kind: "edit", target: fileBase(args["file_path"] ?? args["path"]), detail: nil, done: false, failed: nil)
    case "Bash", "PowerShell":
        let target = shortText(args["description"], 100).isEmpty
            ? shortText(args["command"], 100)
            : shortText(args["description"], 100)
        return RemoteAction(kind: "bash", target: target.isEmpty ? "shell" : target, detail: nil, done: false, failed: nil)
    case "Glob":
        return RemoteAction(kind: "glob", target: shortText(args["pattern"], 80).isEmpty ? shortText(args["path"], 80) : shortText(args["pattern"], 80), detail: nil, done: false, failed: nil)
    case "Grep":
        let target = shortText(args["pattern"], 80).isEmpty ? shortText(args["path"], 80) : shortText(args["pattern"], 80)
        return RemoteAction(kind: "grep", target: target.isEmpty ? "content" : target, detail: nil, done: false, failed: nil)
    case "WebSearch":
        let query = firstQuery(args["queries"] ?? args["query"])
        return RemoteAction(kind: "search", target: query.isEmpty ? "web" : query, detail: nil, done: false, failed: nil)
    case "WebFetch":
        return RemoteAction(kind: "fetch", target: shortText(args["url"], 100).isEmpty ? "web" : shortText(args["url"], 100), detail: nil, done: false, failed: nil)
    case "Agent", "Task", "AgentFork":
        let description = shortText(args["description"], 80)
        return RemoteAction(kind: "subagent", target: description.isEmpty ? L10n.text("delegate", "委派") : description, detail: nil, done: false, failed: nil)
    case "Workflow":
        return RemoteAction(kind: "workflow", target: shortText(args["name"], 80).isEmpty ? shortText(args["description"], 80) : shortText(args["name"], 80), detail: nil, done: false, failed: nil)
    case "Skill":
        return RemoteAction(kind: "skill", target: shortText(args["skill"] ?? args["name"], 60).isEmpty ? "skill" : shortText(args["skill"] ?? args["name"], 60), detail: nil, done: false, failed: nil)
    case "TodoWrite":
        return RemoteAction(kind: "todo", target: "", detail: nil, done: false, failed: nil)
    case "CronCreate", "CronUpdate", "CronDelete", "OffPeakCreate":
        return RemoteAction(kind: "schedule", target: shortText(args["title"], 80).isEmpty ? name : shortText(args["title"], 80), detail: nil, done: false, failed: nil)
    case "AskUserQuestion":
        var target = ""
        if let questions = args["questions"] as? [[String: Any]], let first = questions.first {
            target = shortText(first["question"], 80)
        }
        return RemoteAction(kind: "question", target: target, detail: nil, done: false, failed: nil)
    case "EnterPlanMode", "ExitPlanMode":
        return RemoteAction(kind: "plan", target: "", detail: nil, done: false, failed: nil)
    default:
        if name.hasPrefix("mcp__") {
            let parts = name.components(separatedBy: "__").filter { !$0.isEmpty }
            let target = parts.count > 2 ? "\(parts[1]) · \(parts[2])" : parts.dropFirst().joined(separator: " · ")
            return RemoteAction(kind: "mcp", target: shortText(target, 80), detail: nil, done: false, failed: nil)
        }
        return RemoteAction(kind: "tool", target: shortText(name, 60), detail: nil, done: false, failed: nil)
    }
}

func todosForArgs(_ args: [String: Any]) -> RemoteTodos? {
    guard let rawTodos = args["todos"] as? [[String: Any]] else { return nil }
    let items = rawTodos.prefix(24).compactMap { item -> (String, String)? in
        let content = shortText(item["content"], 160)
        guard !content.isEmpty else { return nil }
        let status = (item["status"] as? String) ?? ""
        return (content, status == "completed" || status == "in_progress" ? status : "pending")
    }
    guard !items.isEmpty else { return nil }
    let completed = items.filter { $0.1 == "completed" }.count
    let current = items.first { $0.1 == "in_progress" }?.0 ?? ""
    return RemoteTodos(total: items.count, completed: completed, current: current)
}

// MARK: - 会话状态机（原 dsh Host 侧 progress 逻辑，改为消费 hook 事件）

final class SessionState {
    let id: String
    var project: String
    var kind = "running"
    var phase = "starting"
    var turn = 0
    var step = 0
    var tool = ""
    var toolCount = 0
    var turnStartedAt: Double = 0
    var lastAt: Double = 0
    var action: RemoteAction?
    var todos: RemoteTodos?
    var trail: [RemoteTrailItem] = []
    var pendingKind = ""
    var pendingTool = ""

    init(id: String, project: String, at: Double) {
        self.id = id
        self.project = project
        lastAt = at
        turnStartedAt = at
    }

    func pushTrail(kind: String, label: String, at: Double, actionKind: String? = nil, done: Bool? = nil, failed: Bool? = nil) {
        trail.append(RemoteTrailItem(kind: kind, label: label, at: at, actionKind: actionKind, done: done, failed: failed))
        if trail.count > 6 { trail = Array(trail.suffix(6)) }
    }

    func apply(event: String, atMs: Double, payload: [String: Any], cwd: String) {
        let project = projectName(cwd)
        if !project.isEmpty { self.project = project }
        lastAt = atMs

        switch event {
        case "SessionStart":
            kind = "running"
            phase = "starting"
            pendingKind = ""
            pendingTool = ""
            if turnStartedAt == 0 { turnStartedAt = atMs }

        case "UserPromptSubmit":
            turn += 1
            step = 0
            tool = ""
            toolCount = 0
            phase = "thinking"
            action = nil
            trail = []
            turnStartedAt = atMs
            kind = "running"
            pendingKind = ""
            pendingTool = ""

        case "PreToolUse":
            let name = payloadString(payload, ["tool_name", "toolName"])
            let args = parseToolArguments(payload["tool_input"] ?? payload["toolInput"])
            let action = actionForTool(name, args)
            step += 1
            tool = name
            toolCount += 1
            phase = "tool"
            kind = "running"
            pendingKind = ""
            pendingTool = ""
            self.action = action
            if name == "TodoWrite", let todos = todosForArgs(args) {
                self.todos = todos
            }
            pushTrail(kind: "action", label: action.target, at: atMs, actionKind: action.kind, done: false)

        case "PermissionRequest":
            kind = "waiting"
            pendingKind = "approval"
            let name = payloadString(payload, ["tool_name", "toolName"])
            pendingTool = name.isEmpty ? shortText(payloadString(payload, ["reason"]), 60) : name

        case "PostToolUse":
            markCurrentActionDone(failed: false)
            phase = "thinking"
            tool = ""

        case "PostToolUseFailure":
            markCurrentActionDone(failed: true)
            phase = "thinking"
            tool = ""
            kind = "running"

        case "Stop":
            phase = "done"
            kind = "done"
            tool = ""
            pendingKind = ""
            pendingTool = ""

        default:
            break
        }
    }

    private func markCurrentActionDone(failed: Bool) {
        if let current = action {
            action = RemoteAction(kind: current.kind, target: current.target, detail: current.detail, done: true, failed: failed)
            if let last = trail.last, last.kind == "action", last.actionKind == current.kind {
                trail[trail.count - 1] = RemoteTrailItem(
                    kind: last.kind, label: last.label, at: last.at,
                    actionKind: last.actionKind, done: true, failed: failed
                )
            }
        }
    }

    func task(nowMs: Double) -> RemoteTask {
        let elapsed: Double
        if turnStartedAt > 0 {
            elapsed = phase == "done"
                ? max(0, lastAt - turnStartedAt)
                : max(0, nowMs - turnStartedAt)
        } else {
            elapsed = 0
        }
        let progress = RemoteProgress(
            phase: phase,
            turn: turn,
            step: step,
            tool: tool,
            toolCount: toolCount,
            elapsedMs: elapsed,
            updatedAt: lastAt,
            action: action,
            todos: todos,
            trail: Array(trail.suffix(4))
        )
        return RemoteTask(
            id: id,
            title: project.isEmpty ? "ZCode" : project,
            project: project,
            kind: kind,
            pendingKind: pendingKind.isEmpty ? nil : pendingKind,
            pendingTool: pendingTool.isEmpty ? nil : pendingTool,
            current: false,
            updatedAt: lastAt,
            progress: progress
        )
    }
}

final class SessionStore {
    private(set) var sessions: [String: SessionState] = [:]

    static let maxTasks = 16

    func apply(event: String, atMs: Double, payload: [String: Any], cwd: String) {
        let id = payloadString(payload, ["session_id", "sessionId"])
        let key = id.isEmpty ? "(unknown)" : id
        let state = sessions[key] ?? SessionState(id: key, project: projectName(cwd), at: atMs)
        sessions[key] = state
        state.apply(event: event, atMs: atMs, payload: payload, cwd: cwd)
    }

    /// 超时清理：running 60 分钟、waiting 12 小时、done 10 分钟无事件即移除。
    func prune(nowMs: Double) {
        let runningStale: Double = 60 * 60 * 1000
        let waitingStale: Double = 12 * 60 * 60 * 1000
        let doneStale: Double = 10 * 60 * 1000
        sessions = sessions.filter { _, state in
            let age = nowMs - state.lastAt
            switch state.kind {
            case "waiting": return age < waitingStale
            case "done": return age < doneStale
            default: return age < runningStale
            }
        }
    }

    func snapshot(nowMs: Double) -> [RemoteTask] {
        prune(nowMs: nowMs)
        let tasks = sessions.values.map { $0.task(nowMs: nowMs) }
            .sorted { left, right in
                if left.updatedAt != right.updatedAt { return left.updatedAt > right.updatedAt }
                return left.id < right.id
            }
        return Array(tasks.prefix(Self.maxTasks))
    }
}

// MARK: - 事件文件监听

struct HookEvent {
    let event: String
    let atMs: Double
    let cwd: String
    let payload: [String: Any]
}

final class FeedWatcher {
    static let stateRoot: URL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/XiaoqiPet", isDirectory: true)
    static let feedDir: URL = stateRoot.appendingPathComponent("feed", isDirectory: true)
    static let emoteDir: URL = stateRoot.appendingPathComponent("emote", isDirectory: true)

    /// 每轮扫描收到的事件按时间排序后整批回调（主线程）。
    var onBatch: ((_ events: [HookEvent], _ emotes: [[String: Any]]) -> Void)?

    private var timer: Timer?
    private let readOnly: Bool

    init(readOnly: Bool = false) {
        self.readOnly = readOnly
    }

    func start() {
        if !readOnly {
            try? FileManager.default.createDirectory(at: Self.feedDir, withIntermediateDirectories: true)
            try? FileManager.default.createDirectory(at: Self.emoteDir, withIntermediateDirectories: true)
        }
        scan()
        let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.scan()
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    func scan() {
        var events: [HookEvent] = []
        var emotes: [[String: Any]] = []

        scanDirectory(Self.feedDir) { envelope in
            guard let event = envelope["event"] as? String else { return }
            let atSeconds = (envelope["at"] as? NSNumber)?.doubleValue ?? 0
            let payload = envelope["payload"] as? [String: Any] ?? [:]
            // 事件自身的 ISO 时间戳最精确；缺失时才退回 hook 落盘时刻（秒级）。
            let payloadMs = isoToMs(payloadString(payload, ["timestamp"]))
            let atMs = payloadMs > 0 ? payloadMs : atSeconds * 1000
            let cwd = (envelope["cwd"] as? String) ?? ""
            events.append(HookEvent(event: event, atMs: atMs, cwd: cwd, payload: payload))
        }
        scanDirectory(Self.emoteDir) { envelope in
            emotes.append(envelope)
        }

        events.sort { left, right in
            if left.atMs != right.atMs { return left.atMs < right.atMs }
            return false
        }
        if !events.isEmpty || !emotes.isEmpty {
            onBatch?(events, emotes)
        }
    }

    private func scanDirectory(_ directory: URL, handler: ([String: Any]) -> Void) {
        let fileManager = FileManager.default
        guard let entries = try? fileManager.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey]
        ) else { return }
        for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            guard entry.lastPathComponent.hasSuffix(".json"),
                  !entry.lastPathComponent.hasPrefix(".") else { continue }
            let values = try? entry.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey])
            guard values?.isRegularFile == true else { continue }
            guard let data = try? Data(contentsOf: entry),
                  let object = try? JSONSerialization.jsonObject(with: data),
                  let envelope = object as? [String: Any] else {
                discard(entry: entry)
                continue
            }
            handler(envelope)
            discard(entry: entry)
        }
    }

    /// 诊断模式只读不删；正常运行消费完立即删除（事件文件都是先写临时文件再原子改名，不会读到半截）。
    private func discard(entry: URL) {
        guard !readOnly else { return }
        try? FileManager.default.removeItem(at: entry)
    }
}

// MARK: - 用量与余额（肚子上的胶囊）

/// 来自 ZCode 本地用量库（~/.zcode/cli/db/db.sqlite，只读）的今日/本周 token 统计。
struct UsageSnapshot: Equatable {
    let todayTotal: Int
    let todayInput: Int
    let todayOutput: Int
    let todayReasoning: Int
    let todayTurns: Int
    let todayTools: Int
    let weekTotal: Int
}

/// 用户在 balance.json 里配置的远端额度接口返回的一条余量。
struct RemoteBalance: Equatable {
    let label: String
    let display: String
    let fetchedAt: Date
}

struct BalanceInfo: Equatable {
    let usage: UsageSnapshot?
    let remote: RemoteBalance?
    let remoteError: String?
    let updatedAt: Date
}

func formatTokens(_ value: Int) -> String {
    func trimmed(_ number: Double, _ unit: String) -> String {
        let text = String(format: "%.1f", number)
        return (text.hasSuffix(".0") ? String(text.dropLast(2)) : text) + unit
    }
    if value >= 1_000_000 { return trimmed(Double(value) / 1_000_000, "M") }
    if value >= 1_000 { return trimmed(Double(value) / 1_000, "k") }
    return "\(value)"
}

final class BalanceProvider {
    static let ttl: TimeInterval = 60
    static let configURL = FeedWatcher.stateRoot.appendingPathComponent("balance.json")

    struct RemoteConfig {
        let url: URL
        let headers: [String: String]
        let valuePath: String
        let label: String
        let prefix: String
        let suffix: String
    }

    private(set) var current: BalanceInfo?
    private var lastRefresh = Date.distantPast
    private var inFlight = false

    var isStale: Bool { Date().timeIntervalSince(lastRefresh) >= Self.ttl }

    static func databasePath() -> String {
        let base = ProcessInfo.processInfo.environment["ZCODE_DATA_BASE_DIR"] ?? NSHomeDirectory()
        return (base as NSString).appendingPathComponent(".zcode/cli/db/db.sqlite")
    }

    func refresh(force: Bool, completion: @escaping (BalanceInfo) -> Void) {
        guard force || isStale else {
            if let current { completion(current) }
            return
        }
        guard !inFlight else { return }
        inFlight = true
        lastRefresh = Date()
        let usage = Self.readUsage()
        guard let config = Self.readRemoteConfig() else {
            let info = BalanceInfo(usage: usage, remote: nil, remoteError: nil, updatedAt: Date())
            current = info
            inFlight = false
            completion(info)
            return
        }
        Self.fetchRemote(config) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                let info: BalanceInfo
                switch result {
                case .success(let remote):
                    info = BalanceInfo(usage: usage, remote: remote, remoteError: nil, updatedAt: Date())
                case .failure(let error):
                    info = BalanceInfo(usage: usage, remote: self.current?.remote, remoteError: error.localizedDescription, updatedAt: Date())
                }
                self.current = info
                self.inFlight = false
                completion(info)
            }
        }
    }

    // MARK: 本地用量

    static func readUsage() -> UsageSnapshot? {
        let path = databasePath()
        guard FileManager.default.fileExists(atPath: path) else { return nil }
        var db: OpaquePointer?
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
            if db != nil { sqlite3_close(db) }
            return nil
        }
        defer { sqlite3_close(db) }

        let now = Date()
        let startOfToday = Calendar.current.startOfDay(for: now).timeIntervalSince1970 * 1000
        let weekAgo = now.addingTimeInterval(-7 * 86_400).timeIntervalSince1970 * 1000

        guard let today = sumUsage(db, sinceMs: startOfToday),
              let week = sumUsage(db, sinceMs: weekAgo) else { return nil }
        return UsageSnapshot(
            todayTotal: today.total,
            todayInput: today.input,
            todayOutput: today.output,
            todayReasoning: today.reasoning,
            todayTurns: today.turns,
            todayTools: today.tools,
            weekTotal: week.total
        )
    }

    private struct UsageRow {
        let total: Int
        let input: Int
        let output: Int
        let reasoning: Int
        let turns: Int
        let tools: Int
    }

    private static func sumUsage(_ db: OpaquePointer, sinceMs: Double) -> UsageRow? {
        let sql = """
        SELECT COALESCE(SUM(computed_total_tokens), 0), COALESCE(SUM(input_tokens), 0),
               COALESCE(SUM(output_tokens), 0), COALESCE(SUM(reasoning_tokens), 0),
               COUNT(*), COALESCE(SUM(tool_call_count), 0)
        FROM turn_usage WHERE started_at >= ?
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { return nil }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int64(statement, 1, sqlite3_int64(sinceMs))
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        return UsageRow(
            total: Int(sqlite3_column_int64(statement, 0)),
            input: Int(sqlite3_column_int64(statement, 1)),
            output: Int(sqlite3_column_int64(statement, 2)),
            reasoning: Int(sqlite3_column_int64(statement, 3)),
            turns: Int(sqlite3_column_int64(statement, 4)),
            tools: Int(sqlite3_column_int64(statement, 5))
        )
    }

    // MARK: 远端余量（可选）

    static func readRemoteConfig() -> RemoteConfig? {
        guard let data = try? Data(contentsOf: configURL),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dict = object as? [String: Any],
              let urlText = dict["url"] as? String,
              let url = URL(string: urlText) else { return nil }
        var headers: [String: String] = [:]
        if let raw = dict["headers"] as? [String: Any] {
            for (key, value) in raw {
                if let text = value as? String { headers[key] = text }
            }
        }
        return RemoteConfig(
            url: url,
            headers: headers,
            valuePath: (dict["valuePath"] as? String) ?? "",
            label: (dict["label"] as? String) ?? L10n.text("Plan balance", "套餐余量"),
            prefix: (dict["prefix"] as? String) ?? "",
            suffix: (dict["suffix"] as? String) ?? ""
        )
    }

    static func extractValue(_ json: Any, path: String) -> Any? {
        guard !path.isEmpty else { return json }
        var cursor: Any = json
        for component in path.split(separator: ".") {
            let key = String(component)
            if let dict = cursor as? [String: Any], let next = dict[key] {
                cursor = next
            } else if let array = cursor as? [Any], let index = Int(key), array.indices.contains(index) {
                cursor = array[index]
            } else {
                return nil
            }
        }
        return cursor
    }

    static func displayValue(_ value: Any?) -> String? {
        if let number = value as? NSNumber {
            let double = number.doubleValue
            if double == double.rounded() && abs(double) < 1e15 {
                return NumberFormatter.localizedString(from: NSNumber(value: Int(double)), number: .decimal)
            }
            return String(format: "%.2f", double)
        }
        if let text = value as? String, !text.isEmpty { return text }
        return nil
    }

    private static func fetchRemote(_ config: RemoteConfig, completion: @escaping (Result<RemoteBalance, Error>) -> Void) {
        var request = URLRequest(url: config.url)
        request.timeoutInterval = 6
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (key, value) in config.headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        let session = URLSession(configuration: .ephemeral)
        session.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(error))
                return
            }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let data else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                completion(.failure(NSError(domain: "XiaoqiBalance", code: code, userInfo: [NSLocalizedDescriptionKey: "HTTP \(code)"])))
                return
            }
            guard let json = try? JSONSerialization.jsonObject(with: data),
                  let display = displayValue(extractValue(json, path: config.valuePath)) else {
                completion(.failure(NSError(domain: "XiaoqiBalance", code: 1, userInfo: [NSLocalizedDescriptionKey: L10n.text("valuePath not found in response", "响应里找不到 valuePath")])))
                return
            }
            completion(.success(RemoteBalance(label: config.label, display: config.prefix + display + config.suffix, fetchedAt: Date())))
        }.resume()
    }
}

// MARK: - 宠物模型

final class PetModel: ObservableObject {
    @Published private(set) var tasks: [RemoteTask] = []
    @Published private(set) var connected = false
    @Published private(set) var lastUpdated: Date?
    @Published private(set) var emoteSpeech = ""
    @Published private(set) var emoteUntil: Date?
    @Published private(set) var balance: BalanceInfo?
    @Published var boardOpen = false
    @Published var locked: Bool {
        didSet { UserDefaults.standard.set(locked, forKey: "xiaoqi.pet.locked") }
    }

    var onNotice: ((PetNotice) -> Void)?
    var onStateChange: (() -> Void)?

    private let store = SessionStore()
    private let balanceProvider = BalanceProvider()
    private var previousKinds: [String: String] = [:]
    private var previousWaiting: Set<String> = []
    private var didSeed = false
    private var lastEventAt: Double = 0

    init() {
        locked = UserDefaults.standard.bool(forKey: "xiaoqi.pet.locked")
    }

    // MARK: 用量 / 余额

    func refreshBalance(force: Bool) {
        balanceProvider.refresh(force: force) { [weak self] info in
            guard let self else { return }
            self.balance = info
            self.onStateChange?()
        }
    }

    /// 肚子胶囊：配置了远端额度就显示余量，否则显示今日 token 用量。
    var balanceText: String? {
        guard let balance else { return nil }
        if let remote = balance.remote { return remote.display }
        if let usage = balance.usage {
            return L10n.text("Today \(formatTokens(usage.todayTotal))", "今日 \(formatTokens(usage.todayTotal))")
        }
        return nil
    }

    var balanceDetail: String? {
        guard let balance else { return nil }
        var lines: [String] = []
        if let remote = balance.remote {
            let formatter = DateFormatter()
            formatter.dateFormat = "HH:mm"
            lines.append(L10n.text(
                "\(remote.label) \(remote.display) · updated \(formatter.string(from: remote.fetchedAt))",
                "\(remote.label) \(remote.display) · \(formatter.string(from: remote.fetchedAt)) 更新"
            ))
        } else if let error = balance.remoteError {
            lines.append(L10n.text("Plan balance unavailable: \(error)", "套餐余量获取失败：\(error)"))
        }
        if let usage = balance.usage {
            lines.append(L10n.text(
                "Today \(formatTokens(usage.todayTotal)) tokens · in \(formatTokens(usage.todayInput)) · out \(formatTokens(usage.todayOutput)) · reasoning \(formatTokens(usage.todayReasoning)) · \(usage.todayTurns) turns · \(usage.todayTools) tools · 7d \(formatTokens(usage.weekTotal))",
                "今日 \(formatTokens(usage.todayTotal)) tokens · 输入 \(formatTokens(usage.todayInput)) · 输出 \(formatTokens(usage.todayOutput)) · 推理 \(formatTokens(usage.todayReasoning)) · \(usage.todayTurns) 轮 · \(usage.todayTools) 次工具 · 近 7 天 \(formatTokens(usage.weekTotal))"
            ))
        }
        return lines.isEmpty ? nil : lines.joined(separator: "\n")
    }

    // MARK: 事件入口

    func applyBatch(_ events: [HookEvent], _ emotes: [[String: Any]]) {
        let nowMs = Date().timeIntervalSince1970 * 1000
        for item in events {
            store.apply(event: item.event, atMs: item.atMs, payload: item.payload, cwd: item.cwd)
            lastEventAt = max(lastEventAt, item.atMs)
        }
        refresh(noticeCheck: true, nowMs: nowMs)

        // 多条互动同批到达时只展示最后一条，避免气泡连发。
        for envelope in emotes {
            applyEmote(envelope)
        }
    }

    func applyEmote(_ envelope: [String: Any]) {
        let speech = shortText(envelope["speech"], 200)
        guard !speech.isEmpty else { return }
        var seconds = (envelope["seconds"] as? NSNumber)?.doubleValue ?? 6
        if seconds <= 0 { seconds = 6 }
        seconds = min(30, max(3, seconds))
        emoteSpeech = speech
        emoteUntil = Date().addingTimeInterval(seconds)
        onNotice?(PetNotice(kind: "emote", title: L10n.text("Xiaoqi", "小栖"), body: speech))
        onStateChange?()
    }

    /// 每秒刷新：让“进行中”的耗时与互动气泡随时间走动；用量每分钟重读一次。
    func tick() {
        if let until = emoteUntil, until < Date() {
            emoteSpeech = ""
            emoteUntil = nil
        }
        refresh(noticeCheck: false, nowMs: Date().timeIntervalSince1970 * 1000)
        if balanceProvider.isStale {
            refreshBalance(force: false)
        }
    }

    // MARK: 派生状态

    var waiting: [RemoteTask] { tasks.filter { $0.kind == "waiting" } }
    var running: [RemoteTask] { tasks.filter { $0.kind == "running" } }
    var done: [RemoteTask] { tasks.filter { $0.kind == "done" } }

    var mood: PetMood {
        if !waiting.isEmpty { return .waiting }
        if !running.isEmpty { return .running }
        if !done.isEmpty { return .done }
        return .idle
    }

    var badgeCount: Int {
        if !waiting.isEmpty { return waiting.count }
        if !done.isEmpty { return done.count }
        return running.count
    }

    var badgeKind: String {
        if !waiting.isEmpty { return "waiting" }
        if !done.isEmpty { return "done" }
        return "running"
    }

    var caption: String {
        if !waiting.isEmpty {
            return L10n.text("\(waiting.count) need you", "\(waiting.count) 个待处理")
        }
        if !running.isEmpty {
            if let focus = running.first, let progress = focus.progress {
                let phase = L10n.phaseShort(progress)
                return running.count > 1
                    ? L10n.text("\(running.count) running · \(phase)", "\(running.count) 进行中 · \(phase)")
                    : phase
            }
            return L10n.text("\(running.count) running", "\(running.count) 进行中")
        }
        if !done.isEmpty {
            return L10n.text("\(done.count) finished", "\(done.count) 个已完成")
        }
        return connected ? L10n.text("Quietly here", "安静陪伴") : L10n.text("Waiting for ZCode…", "等待 ZCode…")
    }

    var summary: String {
        var parts: [String] = []
        if !waiting.isEmpty {
            parts.append(L10n.text("\(waiting.count) need you", "\(waiting.count) 个任务需要你"))
        }
        if !running.isEmpty {
            parts.append(L10n.text("\(running.count) running", "\(running.count) 个任务进行中"))
        }
        if !done.isEmpty {
            parts.append(L10n.text("\(done.count) just finished", "\(done.count) 个任务刚完成"))
        }
        if parts.isEmpty {
            return connected
                ? L10n.text("All sessions are quiet", "所有会话都在休息")
                : L10n.text("Waiting for ZCode hooks", "等待 ZCode 连接")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: 内部

    private func refresh(noticeCheck: Bool, nowMs: Double) {
        let incoming = store.snapshot(nowMs: nowMs)
        tasks = incoming
        lastUpdated = Date()
        connected = !incoming.isEmpty || (lastEventAt > 0 && nowMs - lastEventAt < 10 * 60 * 1000)

        if noticeCheck {
            let oldKinds = previousKinds
            let oldWaiting = previousWaiting
            var fresh: [PetNotice] = []
            for task in incoming {
                if task.kind == "waiting", !oldWaiting.contains(task.id) {
                    fresh.append(PetNotice(
                        kind: "waiting",
                        title: task.title,
                        body: L10n.pending(kind: task.pendingKind, tool: task.pendingTool)
                    ))
                } else if task.kind == "done", oldKinds[task.id] == "running" {
                    fresh.append(PetNotice(
                        kind: "done",
                        title: task.title,
                        body: L10n.text("Task complete", "任务完成")
                    ))
                }
            }
            if didSeed, let notice = fresh.first {
                onNotice?(notice)
            }
            previousKinds = Dictionary(uniqueKeysWithValues: incoming.map { ($0.id, $0.kind) })
            previousWaiting = Set(incoming.filter { $0.kind == "waiting" }.map(\.id))
            didSeed = true
        }
        onStateChange?()
    }

    func toggleLock() {
        locked.toggle()
    }

    func activateZCode() {
        if let app = NSRunningApplication.runningApplications(withBundleIdentifier: "dev.zcode.app").first {
            app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
            return
        }
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "dev.zcode.app") else { return }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration()) { _, _ in }
    }
}

// MARK: - 诊断输出（--diagnose）

enum XiaoqiDiagnose {
    static func run() -> String {
        let watcher = FeedWatcher(readOnly: true)
        let store = SessionStore()
        var emoteCount = 0

        watcher.onBatch = { events, emotes in
            for item in events {
                store.apply(event: item.event, atMs: item.atMs, payload: item.payload, cwd: item.cwd)
            }
            emoteCount += emotes.count
        }

        let feedFiles = (try? FileManager.default.contentsOfDirectory(
            at: FeedWatcher.feedDir, includingPropertiesForKeys: nil
        ))?.filter { $0.lastPathComponent.hasSuffix(".json") } ?? []
        let feedCount = feedFiles.count
        watcher.scan()

        let nowMs = Date().timeIntervalSince1970 * 1000
        let tasks = store.snapshot(nowMs: nowMs)
        var report: [String: Any] = [
            "feedDir": FeedWatcher.feedDir.path,
            "pendingFeedFiles": feedCount,
            "parsedEmotes": emoteCount,
            "tasks": tasks.map { task in
                [
                    "id": task.id,
                    "title": task.title,
                    "kind": task.kind,
                    "phase": task.progress?.phase ?? "",
                    "action": task.progress.flatMap { progress in
                        progress.action.map { L10n.actionLabel($0) }
                    } ?? "",
                    "elapsedMs": task.progress?.elapsedMs ?? 0,
                ] as [String: Any]
            },
        ]
        if feedCount > 0 && tasks.isEmpty {
            report["unparsedFeedFiles"] = feedCount
        }
        if tasks.isEmpty && feedCount == 0 {
            report["hint"] = FeedError.noEvents.errorDescription ?? ""
        }
        if let usage = BalanceProvider.readUsage() {
            report["usage"] = [
                "database": BalanceProvider.databasePath(),
                "todayTotalTokens": usage.todayTotal,
                "todayInput": usage.todayInput,
                "todayOutput": usage.todayOutput,
                "todayReasoning": usage.todayReasoning,
                "todayTurns": usage.todayTurns,
                "todayToolCalls": usage.todayTools,
                "weekTotalTokens": usage.weekTotal,
                "belly": L10n.text("Today \(formatTokens(usage.todayTotal))", "今日 \(formatTokens(usage.todayTotal))"),
            ] as [String: Any]
        } else {
            report["usage"] = "unavailable: \(BalanceProvider.databasePath())"
        }
        report["remoteBalanceConfig"] = FileManager.default.fileExists(atPath: BalanceProvider.configURL.path)
            ? BalanceProvider.configURL.path
            : "not configured"

        guard let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]),
              let text = String(data: data, encoding: .utf8) else {
            return "diagnose-encode-failed"
        }
        return text
    }
}
