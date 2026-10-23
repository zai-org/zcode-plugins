(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZUsageTurnStats = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

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
          turn = { sessionId: snapshot.sessionId, turnId: key, rows: new Map(), samples: [], observedAt: at };
          turns.set(key, turn);
        }
        turn.rows.set(row.rowId, row);
      }
      for (const turn of turns.values()) {
        let characters = 0;
        for (const id of turn.rows.keys()) if (!currentIds.has(id)) turn.rows.delete(id);
        if (turn.rows.size === 0) { turns.delete(turn.turnId); continue; }
        for (const row of turn.rows.values()) {
          const text = row.kind === 'assistantText' || row.kind === 'reasoning' ? row.text :
            row.kind === 'toolCall' ? row.inputText : '';
          if (typeof text === 'string') characters += Array.from(text).length;
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
            startedAt: Number.isFinite(act.startedAt) ? act.startedAt : null }
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
      return {
        sessionId: turn.sessionId, turnId, state: header.state, complete,
        outputTokens, modelMs, durationMs,
        // 宿主恢复的起止时刻用于诊断；缺失或非有限数保留为未知。
        startedAt: Number.isFinite(header.startedAt) ? header.startedAt : null,
        endedAt: Number.isFinite(header.endedAt) ? header.endedAt : null,
        toolMs: Number.isFinite(header.toolDurationMs) && header.toolDurationMs >= 0 ? header.toolDurationMs : null,
        characterRate, observedMs: Math.max(0, sampledAt - turn.observedAt),
        runningTool,   // null=没有进行中的工具（流式正文阶段/全部完成）；name 可能为空串（fallback 显示"执行中"）
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

  function subscribeStore(store, tracker, changed) {
    if (!store || typeof store.getState !== 'function' || typeof store.subscribe !== 'function') return null;
    let closed = false;
    const update = () => {
      if (closed) return;
      const state = store.getState();
      if (tracker.ingest(state && state.snapshot)) changed();
    };
    const off = store.subscribe(update);
    if (typeof off !== 'function') { closed = true; return null; }
    update();
    return () => { if (closed) return; closed = true; try { off(); } finally { tracker.dispose(); } };
  }

  // cn=true 时 token 数量按万/亿显示（≥1 亿用亿、≥1 万用万，至多两位小数去尾零，数字与单位不留空格），
  // 与 overlay.js fmt() / token_rate.py fmt_cn 同规则；不足 1 万沿用千分位。
  function formatTokens(n, cn) {
    if (cn && n >= 1e8) return trimFixed(n / 1e8) + '亿';
    if (cn && n >= 1e4) return trimFixed(n / 1e4) + '万';
    return n.toLocaleString();
  }
  function trimFixed(x) { return x.toFixed(2).replace(/\.?0+$/, ''); }

  function format(stats, cn) {
    if (!stats) return '';
    if (!stats.complete) {
      const speed = stats.characterRate === null ? '' : ` · ${stats.characterRate.toFixed(1)} 字符/s`;
      return `⚡ 生成中 · 已观察 ${(stats.observedMs / 1000).toFixed(1)}s${speed}`;
    }
    const speed = stats.tokenRate === null ? '速率不可用' : `${stats.tokenRate.toFixed(1)} token/s`;
    const output = stats.outputTokens === null ? '输出未知' : `输出 ${formatTokens(stats.outputTokens, cn)} token`;
    const duration = stats.durationMs === null ? '' : ` · 耗时 ${(stats.durationMs / 1000).toFixed(1)}s`;
    const status = stats.state === 'failed' ? ' · 失败' : stats.state === 'completedInterrupted' ? ' · 已中断' : '';
    return `⚡ ${speed} · ${output}${duration}${status}`;
  }

  return { createTracker, subscribeStore, format, formatTokens };
});
