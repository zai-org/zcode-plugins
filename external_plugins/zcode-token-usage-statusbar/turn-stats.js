(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZUsageTurnStats = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  /* 码点计数：与 Array.from(text).length 等价（字符串迭代器语义——高低代理对记 1，孤立代理项
   * 各记 1），但不分配数组。ingest 跑在宿主 store 通知链内，流式期间每次通知都要对窗口内
   * 全部文本计数：Array.from 在长文本上是 O(n) 分配 + GC 压力（实测 60 行 / 60k 流式字符
   * 单次 4.1ms），直接拖慢宿主自己的流式渲染。 */
  function countCodePoints(text) {
    let n = text.length;
    for (let i = 0, last = n - 1; i < last; i++) {
      const c = text.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        const d = text.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { n--; i++; }
      }
    }
    return n;
  }

  function createTracker(options = {}) {
    const now = options.now || (() => performance.now());
    const turns = new Map();
    let epoch = null;
    let session = null;
    let sequence = -1;
    let disposed = false;

    function ingest(snapshot) {
      if (disposed || !snapshot || typeof snapshot.sessionId !== 'string' ||
          typeof snapshot.logEpoch !== 'string' || !Number.isSafeInteger(snapshot.seq) ||
          !snapshot.rows || !Array.isArray(snapshot.rows.window)) return false;
      if (epoch !== snapshot.logEpoch || session !== snapshot.sessionId) {
        turns.clear();
        epoch = snapshot.logEpoch;
        session = snapshot.sessionId;
        sequence = -1;
      }
      if (snapshot.seq <= sequence) return false;
      sequence = snapshot.seq;
      const at = now();
      const currentIds = new Set(snapshot.rows.window.map(row => row && row.rowId));
      for (const row of snapshot.rows.window) {
        if (!row || typeof row.turnId !== 'string' || !Number.isSafeInteger(row.rowId)) continue;
        const key = row.productTurnId || row.turnId;
        let turn = turns.get(key);
        if (!turn) {
          turn = { sessionId: snapshot.sessionId, turnId: key, rows: new Map(), samples: [], observedAt: at, counts: new Map() };
          turns.set(key, turn);
        }
        turn.rows.set(row.rowId, row);
      }
      for (const turn of turns.values()) {
        let characters = 0;
        for (const id of turn.rows.keys()) if (!currentIds.has(id)) { turn.rows.delete(id); turn.counts.delete(id); }
        if (turn.rows.size === 0) { turns.delete(turn.turnId); continue; }
        for (const row of turn.rows.values()) {
          const text = row.kind === 'assistantText' || row.kind === 'reasoning' ? row.text :
            row.kind === 'toolCall' ? row.inputText : '';
          if (typeof text === 'string') {
            // 按 rowId 缓存码点数，文本相同（同一引用时 === 为 O(1)）直接复用；流式行每次通知
            // 文本都变，只重算它自己，已完成的长行/大工具入参不再重复计数。
            let c = turn.counts.get(row.rowId);
            if (!c || c.text !== text) { c = { text, n: countCodePoints(text) }; turn.counts.set(row.rowId, c); }
            characters += c.n;
          }
          // 只要曾经见过这一轮处于未完成状态，就记作"亲历过"：区分"实时追踪到的完成"
          // 与"刚绑定/重绑时一步到位捞到的历史存量已完成轮次"（后者可能缺详细字段，
          // 调用方据此决定是否展示"完成态"结论，而不是把陈年旧轮误判成刚发生的异常）。
          if (row.kind === 'turnHeader' && row.state &&
              row.state !== 'completedSuccess' && row.state !== 'completedInterrupted' && row.state !== 'failed') {
            turn.seenIncomplete = true;
          }
        }
        const last = turn.samples[turn.samples.length - 1];
        if (last && last.characters > characters) turn.samples.length = 0;
        if (!last || last.characters !== characters) turn.samples.push({ at, characters });
        while (turn.samples.length > 2 && turn.samples[1].at < at - 2000) turn.samples.shift();
      }
      return true;
    }

    function get(turnId) {
      const turn = turns.get(turnId);
      if (!turn) return null;
      const header = Array.from(turn.rows.values()).find(row => row.kind === 'turnHeader');
      if (!header) return null;
      const complete = ['completedSuccess', 'completedInterrupted', 'failed'].includes(header.state);
      const samples = turn.samples;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const sampledAt = now();
      const elapsed = first ? sampledAt - first.at : 0;
      const characterRate = !complete && elapsed >= 200 && last && sampledAt - last.at <= 2000 ?
        Math.max(0, last.characters - first.characters) * 1000 / elapsed : null;
      const outputTokens = Number.isFinite(header.outputTokens) && header.outputTokens >= 0 ? header.outputTokens : null;
      const modelMs = Number.isFinite(header.modelDurationMs) && header.modelDurationMs >= 0 ? header.modelDurationMs : null;
      const durationMs = Number.isFinite(header.activeMs) && header.activeMs >= 0 ? header.activeMs :
        Number.isFinite(header.endedAt) && Number.isFinite(header.startedAt) ? Math.max(0, header.endedAt - header.startedAt) : null;
      // 本轮最后一个活动行（现存行里 rowId 最大的非 header 行——实时重算而不是缓存
      // 引用：行被移出快照窗口后缓存对象不会跟着更新，状态会永远卡在旧的 running 上，
      // loading 状态词就会一直显示"正在读取"。窗口 ≤60 行，重算开销可忽略）若是一个
      // 仍在进行中的工具调用（宿主从 tool_input_start 起就算"进行中"：inputStreaming/
      // pendingApproval/running 三态同权），暴露其名与起始时刻，供调用方在 loading
      // 插槽旁显示"正在读取 · Xs"这类状态词（v76）。
      let act = null;
      for (const row of turn.rows.values()) {
        if (row.kind !== 'turnHeader' && (!act || row.rowId > act.rowId)) act = row;
      }
      const runningTool = act && act.kind === 'toolCall' && typeof act.status === 'string' &&
        (act.status === 'inputStreaming' || act.status === 'pendingApproval' || act.status === 'running')
        ? { name: typeof act.toolName === 'string' ? act.toolName : '',
            startedAt: Number.isFinite(act.startedAt) ? act.startedAt : null,
            // v7：Skill 工具透出截断的输入串——调用方（overlay）从中提取技能名显示
            // 「技能名·执行中」；仅内存投影，不落日志。160 字上限防超长输入。
            inputText: typeof act.inputText === 'string' ? act.inputText.slice(0, 160) : '' }
        : act && act.kind === 'subagent' && act.status === 'running'
        ? { name: 'Agent', startedAt: null,   // 子智能体行无 startedAt：只给动词，不给秒数
            // 行投影自带 childSessionId（宿主 subagent 行 schema）：调用方据此绑定子代理
            // 会话 store 估算其运行期输出速率；无该字段时为 null，调用方按无数据降级。
            childSessionId: typeof act.childSessionId === 'string' && act.childSessionId ? act.childSessionId : null }
        : null;
      // 本轮全部运行中的子智能体行（并行派发时有多行）：runningTool 只反映最后一个
      // 活动行，多槽位速率估算需要完整集合——按 rowId 升序稳定输出，无 childSessionId
      // 的行无法绑定子会话 store，跳过。
      const runningSubagents = [];
      if (!complete) {
        const subs = Array.from(turn.rows.values())
          .filter(row => row.kind === 'subagent' && row.status === 'running' &&
            typeof row.childSessionId === 'string' && row.childSessionId)
          .sort((a, b) => a.rowId - b.rowId);
        for (const row of subs) runningSubagents.push({ childSessionId: row.childSessionId });
      }
      // 当前轮处于哪个阶段（按最后一个活动行的类型判定，供调用方换图标/文案）：
      // reasoning 行流式输出 = 模型在思考；toolCall 进行中 = 工具执行；assistantText = 正文流式。
      const phase = complete ? null :
        act && act.kind === 'reasoning' ? 'thinking' :
        runningTool ? 'tool' :
        act && act.kind === 'assistantText' ? 'writing' : null;
      const runningGroup = runningGroupOf(turn, act, complete);
      return {
        sessionId: turn.sessionId, turnId, state: header.state, complete,
        // 压缩轮（v230）：轮内带 compact 类 timelineMarker。实测宿主投影里压缩轮 =
        // turnHeader + timelineMarker（marker.type='compact'），header.executionKind 恒
        // 'agent' 不能用；调用方据此不把无正文的压缩完成轮误报成「本轮统计不可用」。
        isCompact: Array.from(turn.rows.values()).some(r => r.kind === 'timelineMarker' &&
          r.marker && r.marker.type === 'compact'),
        // 诊断：轮内现存行的 kind 去重集合——普通轮也可能带 timelineMarker（模型切换），
        // 排"压缩/控制轮为何不可用"类问题时对照行构成与 marker 内容。
        kinds: Array.from(new Set(Array.from(turn.rows.values()).map(r => r.kind))).sort(),
        tmr: Array.from(turn.rows.values()).filter(r => r.kind === 'timelineMarker').map(r => {
          try { return JSON.stringify(r.marker === undefined ? r : r.marker).slice(0, 120); } catch (e) { return '?'; }
        }),
        outputTokens, modelMs, durationMs,
        // 宿主恢复的起止时刻用于诊断；缺失或非有限数保留为未知。
        startedAt: Number.isFinite(header.startedAt) ? header.startedAt : null,
        endedAt: Number.isFinite(header.endedAt) ? header.endedAt : null,
        toolMs: Number.isFinite(header.toolDurationMs) && header.toolDurationMs >= 0 ? header.toolDurationMs : null,
        characterRate, observedMs: Math.max(0, sampledAt - turn.observedAt),
        runningTool,   // null=没有进行中的工具（流式正文阶段/全部完成）；name 可能为空串（fallback 显示"执行中"）
        runningGroup,   // v187 补回 v181：null=运行行不在 ≥2 连续同类组尾（含子代理/完成态）；{kind:'explore'|'terminal', startedAt}
        runningSubagents,   // 全部 running subagent 行的 childSessionId（v97 多槽位）；完成态恒 []
        phase,   // 'thinking' | 'tool' | 'writing' | null（完成态恒 null）
        totalCharacters: last ? last.characters : 0,   // 当前累计字符数：供调用方做 c2t（字符→token）自校准
        observedLive: !!turn.seenIncomplete,   // 是否亲历过"未完成→完成"：false=刚绑定/重绑时
          // 一步到位捞到的历史存量已完成轮次，而非这次订阅期间实时追踪到的完成
        tokenRate: complete && outputTokens !== null && modelMs >= 200 && modelMs < 3600000 ? outputTokens * 1000 / modelMs : null,
        source: 'host-projection',
      };
    }

    return { ingest, get, clear() { turns.clear(); epoch = null; sequence = -1; }, dispose() { disposed = true; turns.clear(); } };
  }

  // ---------- 工具组近似（v181 特性，v187 补回——PR #161 合并时遗漏本块）：宿主把当前运行段尾部
  // **连续 ≥2** 的只读工具行在 UI 层合成「查阅」组（exploreGroup），连续 ≥2 的非只读 shell 合成
  // 「终端」组（executeGroup）——组标题是渲染层合成的（chat.toolCall.explore/executeGroup.label），
  // 行数据里没有。状态条 chip 要在组执行期显示「查阅·执行中」而不是逐工具动词，只能按宿主同源
  // 规则在行流上复刻（分类正则与宿主 exploreToolCall.ts/toolIdentity.ts 同文，漂移时一起跟）：
  // - 只读家族按工具名（Read/Grep/Glob/WebSearch/WebFetch/Explore…前缀根匹配，同宿主 family 表）；
  // - shell 家族（Bash 等）按命令文本：全部命令只读 → explore；含写命令/写重定向 → terminal；
  //   命令未到/解析不出（流式半截 JSON）→ defer 透明（宿主 shouldDeferUnclassifiedShellToolCall
  //   同款：不加入也不打断所在组）；有命令但不中只读正则 → terminal（宿主 isExecuteToolCall）；
  // - 其余工具行（Skill/TodoWrite/MCP…）与正文/思考/子代理行一律组边界。
  // 已知近似：宿主另按 kind/title/input 多源推导家族、并剔除隐藏 reasoning 行；chip 是状态
  // 摘要不是协议消费，这类差异可接受。
  const GROUP_EXPLORE_TOOL_RE = /^(?:read|view|open|cat|head|tail|read_file|search|grep|find|fetch|web_search|web_fetch|webfetch|query|lookup|glob|list|ls|dir|tree|explore|inspect)(?:_|$)/i;
  const GROUP_SHELL_TOOL_RE = /^(?:execute|run|exec|bash|shell|command|terminal)(?:_|$)/i;
  const GROUP_READ_RE = /\b(rg|grep|find|ls|cat|head|tail|wc|stat|pwd|which|readlink|tree|sed\s+-n|get-childitem|gci|dir|get-content|gc|type|select-string|sls|get-location|test-path|resolve-path)\b|^git\s+(status|log|show|diff)\b/i;
  const GROUP_WRITE_RE = /\b(sed\s+-i|perl\s+-pi|tee|mv|cp|rm|mkdir|rmdir|touch|truncate|chmod|chown|remove-item|del|erase|set-content|add-content|clear-content|out-file|new-item|move-item|copy-item|rename-item|set-item)\b|^git\s+(add|commit|rm|mv|checkout|switch|restore|reset|clean|revert|cherry-pick|merge|rebase)\b/i;
  const GROUP_REDIRECT_RE = /(^|[^\d<])>>?\s*\S|&>\s*\S/i;

  function groupClassify(row) {
    if (!row || row.kind !== 'toolCall' || typeof row.toolName !== 'string') return null;
    if (GROUP_EXPLORE_TOOL_RE.test(row.toolName)) return 'explore';
    if (!GROUP_SHELL_TOOL_RE.test(row.toolName)) return null;
    // 命令收集与宿主 extractToolCommands 同集（command/cmd/script/parsed_cmd；argv 数组取 -lc 后串）。
    let src = row.input && typeof row.input === 'object' ? row.input : null;
    if (!src && typeof row.inputText === 'string' && row.inputText.trim()) {
      try { src = JSON.parse(row.inputText); } catch (e) { return 'defer'; }   // 半截 JSON：透明
    }
    const cands = [];
    if (typeof src === 'string') cands.push(src);
    else if (Array.isArray(src)) {
      if (src.every(x => typeof x === 'string')) {
        const i = src.indexOf('-lc');
        cands.push(i >= 0 && typeof src[i + 1] === 'string' ? src[i + 1] : src.join(' '));
      }
    } else if (src && typeof src === 'object') {
      for (const k of ['command', 'cmd', 'script', 'parsed_cmd'])
        if (typeof src[k] === 'string' && src[k].trim()) cands.push(src[k].trim());
    }
    if (!cands.length) return 'defer';
    const segs = [];
    for (const c of cands) for (const s of String(c).split(/&&|\|\||;/g)) { const t = s.trim(); if (t) segs.push(t); }
    if (!segs.length) return 'defer';
    for (const s of segs) if (GROUP_WRITE_RE.test(s) || GROUP_REDIRECT_RE.test(s)) return 'terminal';
    for (const s of segs) if (GROUP_READ_RE.test(s)) return 'explore';
    return 'terminal';
  }

  // 运行行（及紧邻的透明行）落在 ≥2 连续同类组尾部才上报组；startedAt 锚定组首行，
  // 供 chip「查阅·执行中 Xs」从组头起算。组首行滑出快照窗口时按窗口内首行起算（仅影响计时）。
  function runningGroupOf(turn, act, complete) {
    if (complete || !act || act.kind !== 'toolCall') return null;
    const ordered = Array.from(turn.rows.values()).sort((a, b) => a.rowId - b.rowId);
    let run = null;
    for (const row of ordered) {
      if (row.rowId > act.rowId) break;
      if (row.kind !== 'toolCall') { run = null; continue; }
      const k = groupClassify(row);
      if (k === 'defer') continue;
      if (run && run.kind === k) run.len += 1;
      else run = k ? { kind: k, firstAt: Number.isFinite(row.startedAt) ? row.startedAt : null, len: 1 } : null;
    }
    return run && run.len >= 2 ? { kind: run.kind, startedAt: run.firstAt } : null;
  }

  /* 通知处理预算（issue #309，specs/perf-lag-reduction.md 规则 12）：桥 v2 的 getState() 是整窗深拷贝，
   * 长会话（数千行）里「读 store + ingest + 回调」一次就几十毫秒，流式期间每秒数次通知就把主线程占满。
   * 上一次处理实测 ≥ MIN_COST 时，下一次处理至少间隔 min(MAX_GAP, cost × GAP_RATIO)（插件占比 ≤ ~10%）；
   * 间隔内的通知只置 pending，由唯一的尾部定时器在间隔届满时处理**最新**状态（中间快照不读不 ingest，
   * ingest 以 seq 单调，丢中间帧无副作用）。廉价会话（cost < MIN_COST）与此前逐字一致：每次通知同步
   * 处理，不排任何定时器（规则 5：测试与语义依赖通知后同步更新状态条）。 */
  const BUDGET_MIN_COST_MS = 8;
  const BUDGET_GAP_RATIO = 9;
  const BUDGET_MAX_GAP_MS = 1000;

  /* changed(state)：回调拿到本次已读的 state，不应再 store.getState()（v2 桥每读一次 = 一份整窗拷贝）。
   * options.now / setTimeout / clearTimeout 是测试注入缝，缺省取 performance.now 与全局定时器。 */
  function subscribeStore(store, tracker, changed, options = {}) {
    if (!store || typeof store.getState !== 'function' || typeof store.subscribe !== 'function') return null;
    const now = options.now || (() =>
      typeof performance === 'object' && performance && typeof performance.now === 'function' ? performance.now() : Date.now());
    // AGENTS §4：全局定时器缺席时不抛进宿主通知链——arm 返回 null，调用方退回同步处理
    const arm = options.setTimeout || ((fn, ms) => (typeof setTimeout === 'function' ? setTimeout(fn, ms) : null));
    const disarm = options.clearTimeout || (t => { if (typeof clearTimeout === 'function') clearTimeout(t); });
    let closed = false, timer = null, pending = false, lastEnd = 0, lastCost = 0;
    const run = () => {
      const started = now();
      /* changed() 跑在宿主 store 的通知分发链上，异常会冒进宿主其它订阅者——统一兜住
       * （调用方 overlay 侧另有 try 记录诊断，这里是不让异常出模块的最后闸）。 */
      try {
        const state = store.getState();
        if (tracker.ingest(state && state.snapshot)) changed(state);
      } catch (e) { /* 单次通知失败不影响后续订阅 */ }
      lastEnd = now();
      lastCost = lastEnd - started;
    };
    const flush = () => {
      timer = null;
      if (closed || !pending) return;
      pending = false;
      run();
    };
    const update = () => {
      if (closed) return;
      if (lastCost >= BUDGET_MIN_COST_MS) {
        const wait = Math.min(BUDGET_MAX_GAP_MS, lastCost * BUDGET_GAP_RATIO) - (now() - lastEnd);
        if (wait > 0) {
          pending = true;
          if (timer === null) {
            let t = null;
            try { t = arm(flush, wait); } catch (e) { t = null; }
            if (t !== null && t !== undefined) {
              timer = t;
              if (typeof timer.unref === 'function') timer.unref();   // 不挂住 Node 测试进程
              return;
            }
            pending = false;   // 无法排尾部定时器：退回同步处理，绝不留下无人冲刷的 pending
          } else {
            return;
          }
        }
      }
      // 同步处理（廉价会话 / 间隔已过 / 无法排定时器）：先作废待冲刷的尾部定时器——它被后台节流而迟到时，
      // 新通知已处理了最新状态，再让它读一次整窗只是白拷贝。
      if (timer !== null) { try { disarm(timer); } catch (e) { } timer = null; }
      pending = false;
      run();
    };
    const off = store.subscribe(update);
    if (typeof off !== 'function') { closed = true; return null; }
    update();
    return () => {
      if (closed) return;
      closed = true;
      if (timer !== null) { try { disarm(timer); } catch (e) { } timer = null; }   // 尾部定时器归订阅持有，随退订清除
      try { off(); } finally { tracker.dispose(); }
    };
  }

  // cn=true 时 token 数量按万/亿显示（≥1 亿用亿、≥1 万用万，至多两位小数去尾零，数字与单位不留空格），
  // 与 overlay.js fmt() / token_rate.py fmt_cn 同规则；不足 1 万沿用千分位。
  function formatTokens(n, cn, forceKmb) {
    if (forceKmb) {
      // 对原始 token 数按显示精度四舍五入，避免缩放后浮点半数偏差。
      if (n >= 1e9) return (Math.round(n / 1e7) / 100).toFixed(2) + 'B';
      if (n >= 1e6) return (Math.round(n / 1e4) / 100).toFixed(2) + 'M';
      if (n >= 1e3) return (Math.round(n / 100) / 10).toFixed(1) + 'K';
      return String(n);
    }
    if (cn && n >= 1e8) return trimFixed(n / 1e8) + '亿';
    if (cn && n >= 1e4) return trimFixed(n / 1e4) + '万';
    return n.toLocaleString();
  }
  function trimFixed(x) { return x.toFixed(2).replace(/\.?0+$/, ''); }

  function format(stats, cn, forceKmb) {
    if (!stats) return '';
    if (!stats.complete) {
      const speed = stats.characterRate === null ? '' : ` · ${stats.characterRate.toFixed(1)} 字符/s`;
      return `⚡ 生成中 · 已观察 ${(stats.observedMs / 1000).toFixed(1)}s${speed}`;
    }
    const speed = stats.tokenRate == null || !Number.isFinite(stats.tokenRate) ? '生成时长缺失，暂不显示速率' : `${stats.tokenRate.toFixed(1)} token/s`;
    const output = stats.outputTokens === null ? '输出未知' : `输出 ${formatTokens(stats.outputTokens, cn, forceKmb)} token`;
    const duration = stats.durationMs === null ? '' : ` · 耗时 ${(stats.durationMs / 1000).toFixed(1)}s`;
    const status = stats.state === 'failed' ? ' · 失败' : stats.state === 'completedInterrupted' ? ' · 已中断' : '';
    return `⚡ ${speed} · ${output}${duration}${status}`;
  }

  /* ---------- v258：运行时合成桥（renderer_bridge.py BRIDGE_TEMPLATE 当前代的免混淆名同契约实现） ----------
   * 静态桥由 renderer_bridge.py 按版本混淆名打进宿主 asar；客户端升级到 HOST_TARGETS 表外
   * 版本、桥未部署或 Windows 运行期替换被拒时，由本模块在渲染端自行合成同契约的三个只读
   * 访问器（__zusageGetExistingConversationStore / __zusageAcquireConversationStore /
   * __zusageConversationDiagnostics）。宿主 SessionDataLayer 注册表 Map 无法按混淆名定位
   * （名字随版本轮换），靠一次性 Map.prototype 探针按条目形状捕获；捕获后立即还原原型方法
   * （零常驻开销）。key/topic 公式按 renderer_bridge.py AUTO_NAMES 钉死的宿主形状
   * （`${remote??"__base__"} ${workspaceIdentity?.trim()||workspacePath}` / `conversation/<sid>`，
   * 跨版本稳定；宿主若改公式则合成桥静默失配降级 DB，不崩溃）。overlay 每个心跳 tick 重新
   * 探测全局，迟到安装无需重启即被采用。 */
  let zuRegistry = null;   // 捕获的宿主注册表（installRuntimeBridge 注入或探针捕获）
  const ZU_SCOPE_FIELDS_GET = ["sessionId", "workspacePath", "workspaceIdentity", "remoteSessionId"];
  const ZU_SCOPE_FIELDS_ACQUIRE = ["sessionId", "workspacePath", "workspaceIdentity"];
  function zuKeyOf(scope) {
    return `${scope.remoteSessionId ?? "__base__"} ${scope.workspaceIdentity?.trim() || scope.workspacePath}`;
  }
  function zuTopicOf(sessionId) { return "conversation/" + sessionId; }
  function zuSnapshot(value, seen = new WeakMap()) {
    if (value === null || typeof value !== "object") {
      if (typeof value === "function" || typeof value === "symbol")
        throw new TypeError("Unsupported snapshot value");
      return value;
    }
    if (seen.has(value)) return seen.get(value);
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null)
      throw new TypeError("Unsupported snapshot object");
    const result = Array.isArray(value) ? [] : Object.create(null);
    seen.set(value, result);
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!("value" in d)) throw new TypeError("Unsupported snapshot accessor");
      Object.defineProperty(result, key, {
        value: zuSnapshot(d.value, seen), enumerable: d.enumerable,
        writable: false, configurable: false
      });
    }
    if (Array.isArray(value)) result.length = value.length;
    return Object.freeze(result);
  }
  function zuWrapStore(store, current, release) {
    let stopped = false;
    const cancellations = new Set();
    /* 快照缓存按底层状态引用取键（issue #307）：宿主 React 以 useSyncExternalStore
     * （Object.is 语义）消费本包装，同一底层状态必须映射到同一冻结快照，否则宿主把
     * 每次读取都当作「渲染期间 store 又变了」而无限重渲染（React error #185）。
     * 宿主通知先失效缓存再转发——就地变更一经通知即可在下一次读取可见；未经通知的
     * 就地变更按订阅契约本就不可观察。 */
    let lastRaw = null, lastSnap = null, hasSnap = false;
    const off = () => {
      if (stopped) return;
      stopped = true;
      for (const cancel of [...cancellations]) cancel();
      try { release?.(); } catch (_) {}
    };
    const active = () => {
      if (stopped) return false;
      if (current()) return true;
      off();
      return false;
    };
    return Object.freeze({
      getState: () => {
        if (!active()) { hasSnap = false; return null; }
        const raw = store.getState();
        if (!hasSnap || raw !== lastRaw) {
          const snap = zuSnapshot(raw);   // 先构造后提交：构造抛出时缓存原样保留
          lastRaw = raw;
          lastSnap = snap;
          hasSnap = true;
        }
        return lastSnap;
      },
      subscribe: callback => {
        if (typeof callback !== "function") throw new TypeError("Invalid callback");
        if (!active()) return () => {};
        let cancelled = false;
        const cancel = () => {
          if (cancelled) return;
          cancelled = true;
          cancellations.delete(cancel);
          try { unsubscribe(); } catch (_) {}
        };
        const unsubscribe = store.subscribe(() => {
          if (cancelled || !active()) return;
          hasSnap = false;   // 先失效缓存再转发：就地变更也由此覆盖
          try {
            const result = callback();
            if (result && typeof result.then === "function")
              Promise.resolve(result).catch(() => {});
          } catch (_) {}
        });
        cancellations.add(cancel);
        return cancel;
      },
      off
    });
  }
  function zuCheckedScope(scope, fields, noWhitespace) {
    if (!scope || typeof scope !== "object" || Array.isArray(scope))
      throw new TypeError("Invalid conversation scope");
    const descriptors = Object.getOwnPropertyDescriptors(scope);
    if (Reflect.ownKeys(descriptors).some(key => !fields.includes(key)))
      throw new TypeError("Unknown conversation scope field");
    const checked = Object.create(null);
    for (const key of fields) {
      const d = descriptors[key];
      if (!d) continue;
      if (!("value" in d) || typeof d.value !== "string" ||
          !d.value.trim() || /[\x00-\x1f\x7f]/.test(d.value))
        throw new TypeError("Invalid conversation scope field");
      if (noWhitespace.includes(key) && /\s/.test(d.value))
        throw new TypeError("Invalid conversation identifier");
      if (key === "remoteSessionId" && d.value === "__base__")
        throw new TypeError("Reserved remote identifier");
      checked[key] = d.value;
    }
    return checked;
  }
  function zuGetExistingConversationStore(scope) {
    const checked = zuCheckedScope(scope, ZU_SCOPE_FIELDS_GET, ["sessionId", "remoteSessionId"]);
    if (!checked.sessionId || !checked.workspacePath)
      throw new TypeError("Missing conversation scope field");
    const key = zuKeyOf(checked), topic = zuTopicOf(checked.sessionId);
    const entry = zuRegistry.get(key), layer = entry?.layer;
    const session = layer?.entries.get(topic), store = session?.store;
    const current = () => !!store && zuRegistry.get(key) === entry && !entry.stale &&
      !layer.disposed && layer.entries.get(topic) === session &&
      session.store === store && !store.closed;
    if (!current()) return null;
    return zuWrapStore(store, current, null);
  }
  /* 受限 acquire：仅 sess_subagent_ 前缀 + __base__ 本地键；租约 refcount 由宿主持有，
   * 包装层 off() 时 release。scope 校验与 get 同规（非法 throw TypeError）；其余所有
   * miss/失败返回 null（绝不 throw），调用方按 2s 重试。 */
  function zuAcquireConversationStore(scope) {
    const checked = zuCheckedScope(scope, ZU_SCOPE_FIELDS_ACQUIRE, ["sessionId"]);
    if (!checked.sessionId || !checked.sessionId.startsWith("sess_subagent_")) return null;
    const key = zuKeyOf(checked);
    if (typeof key !== "string" || !key.startsWith("__base__ ")) return null;
    const entry = zuRegistry.get(key), layer = entry?.layer;
    if (!entry || entry.stale || !layer || layer.disposed ||
        typeof layer.acquire !== "function") return null;
    const topic = zuTopicOf(checked.sessionId);
    let lease = null;
    try { lease = layer.acquire(checked.sessionId); } catch (_) { return null; }
    const store = lease && lease.store;
    if (!store || store.closed) {
      try { lease?.release(); } catch (_) {}
      return null;
    }
    const current = () => !!store && !store.closed && zuRegistry.get(key) === entry &&
      !entry.stale && !layer.disposed && layer.entries.get(topic)?.store === store;
    return zuWrapStore(store, current, () => lease.release());
  }
  function zuConversationDiagnostics() {
    const keys = [], sessions = [];
    for (const [key, entry] of zuRegistry) {
      keys.push(key);
      const layer = entry && entry.layer;
      if (!layer || layer.disposed || entry.stale) continue;
      for (const [topic, session] of layer.entries) {
        const store = session && session.store;
        const state = store && !store.closed && store.getState();
        sessions.push({ key, topic, status: state ? (state.status || "unknown") : "unavailable",
          seq: state && state.snapshot ? state.snapshot.seq : null });
      }
    }
    return { keys, sessions };
  }
  function zuInstallBridgeGlobals() {
    if (!zuRegistry) return;
    const g = typeof globalThis === "object" && globalThis ? globalThis : null;
    if (!g) return;
    g.__zusageGetExistingConversationStore = zuGetExistingConversationStore;
    g.__zusageAcquireConversationStore = zuAcquireConversationStore;
    g.__zusageConversationDiagnostics = zuConversationDiagnostics;
    if (typeof window === "object" && window && window !== g) {   // vm 沙箱里 window 与 globalThis 分离；真实渲染端二者同一
      window.__zusageGetExistingConversationStore = zuGetExistingConversationStore;
      window.__zusageAcquireConversationStore = zuAcquireConversationStore;
      window.__zusageConversationDiagnostics = zuConversationDiagnostics;
    }
  }
  /* 一次性探针：key 形如 `<remote> <workspace>`（首段无空白）且条目带 layer.entries/acquire、
   * stale/refCount 形状即认定是宿主注册表，当场捕获 this 并还原原生方法（try/finally 保证
   * 原调用返回值与异常完全不变）。Node 直 require（单元测试）无 window，不布防。 */
  let zuOrigMapGet = null, zuOrigMapSet = null;
  const ZU_REGISTRY_KEY_RE = /^(?:__base__|[^\s]+) \S/;
  function zuEntryLooksReal(entry) {
    return !!(entry && typeof entry === "object" && entry.layer &&
      entry.layer.entries instanceof Map && typeof entry.layer.acquire === "function" &&
      typeof entry.stale === "boolean" && typeof entry.refCount === "number");
  }
  function zuRestoreMapProto() {
    try {
      if (zuOrigMapGet) Map.prototype.get = zuOrigMapGet;
      if (zuOrigMapSet) Map.prototype.set = zuOrigMapSet;
    } catch (e) { }
    zuOrigMapGet = null;
    zuOrigMapSet = null;
  }
  function zuCaptureRegistry(map, key, entry) {
    if (zuRegistry || zuOrigMapSet === null || !(map instanceof Map) ||
        typeof key !== "string" || !ZU_REGISTRY_KEY_RE.test(key) || !zuEntryLooksReal(entry)) return;
    zuRegistry = map;
    zuRestoreMapProto();
    zuInstallBridgeGlobals();
  }
  function zuArmRegistryProbe() {
    if (zuRegistry || zuOrigMapGet || typeof Map !== "function" ||
        typeof Map.prototype.get !== "function" || typeof Map.prototype.set !== "function") return;
    if (typeof globalThis.__zusageRegistryHooked !== "undefined") return;   // 上代实例已布防（钩子闭包仍有效）：重注入不叠层
    try {
      zuOrigMapGet = Map.prototype.get;
      zuOrigMapSet = Map.prototype.set;
      Map.prototype.set = function (k, v) {
        const orig = zuOrigMapSet;   // 捕获会就地还原本体方法并置空引用，闭包内先固定本次原函数
        try { zuCaptureRegistry(this, k, v); } catch (e) { }
        return orig.call(this, k, v);
      };
      Map.prototype.get = function (k) {
        const orig = zuOrigMapGet;
        let result;
        try {
          result = orig.call(this, k);
        } finally {
          try { if (result) zuCaptureRegistry(this, k, result); } catch (e) { }
        }
        return result;
      };
      if (typeof globalThis === "object" && globalThis) globalThis.__zusageRegistryHooked = true;
    } catch (e) { zuRestoreMapProto(); }
  }
  /* 测试/运维注入口：已知宿主注册表时直接注入（跳过探针）。重复安装/二次捕获一律拒绝。 */
  function installRuntimeBridge(registryMap) {
    if (!(registryMap instanceof Map) || zuRegistry) return false;
    zuRegistry = registryMap;
    zuRestoreMapProto();
    zuInstallBridgeGlobals();
    return true;
  }
  if (typeof globalThis.__zusageGetExistingConversationStore !== "function" &&
      typeof window !== "undefined" && window && window.document) {
    zuArmRegistryProbe();   // 静态桥缺席（表外版本/未部署）才布防；先注入的静态桥直接短路
  }

  return { createTracker, subscribeStore, format, formatTokens, installRuntimeBridge };
});
