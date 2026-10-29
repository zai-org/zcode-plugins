'use strict';

(() => {
  const Xiaoqi = window.Xiaoqi;
  const stage = document.getElementById('stage');
  const badge = document.getElementById('badge');
  const balance = document.getElementById('balance');
  const bubble = document.getElementById('bubble');
  const bubbleTitle = document.getElementById('bubble-title');
  const bubbleDot = document.getElementById('bubble-dot');
  const bubbleAction = document.getElementById('bubble-action');
  const bubbleTime = document.getElementById('bubble-time');
  const hint = document.getElementById('hint');

  let state = { connected: false, tasks: [], balance: null, emote: null };
  let pointer = null;
  let suppressClick = false;

  function moodFor(tasks) {
    if (tasks.some((task) => task.kind === 'waiting')) return 'waiting';
    if (tasks.some((task) => task.kind === 'running')) return 'running';
    if (tasks.some((task) => task.kind === 'done')) return 'done';
    return 'idle';
  }

  function badgeFor(tasks) {
    const waiting = tasks.filter((task) => task.kind === 'waiting').length;
    const done = tasks.filter((task) => task.kind === 'done').length;
    const running = tasks.filter((task) => task.kind === 'running').length;
    if (waiting) return { count: waiting, kind: 'waiting' };
    if (done) return { count: done, kind: 'done' };
    return { count: running, kind: 'running' };
  }

  function taskLine(task) {
    if (task.kind === 'waiting') return Xiaoqi.pendingText(task);
    if (task.progress && task.progress.action) return Xiaoqi.actionLabel(task.progress.action);
    if (task.progress && task.progress.phase) return Xiaoqi.phaseText(task.progress.phase);
    return Xiaoqi.statusText(task);
  }

  function activeEmote() {
    const emote = state.emote;
    if (!emote || typeof emote.speech !== 'string' || emote.speech === '') return null;
    if (Number.isFinite(emote.until) && emote.until < Date.now()) return null;
    return emote;
  }

  function render() {
    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    document.body.dataset.mood = moodFor(tasks);

    const badgeInfo = badgeFor(tasks);
    if (badgeInfo.count > 0) {
      badge.className = `pet-badge visible ${badgeInfo.kind}`;
      badge.textContent = badgeInfo.count > 9 ? '9+' : String(badgeInfo.count);
      badge.title = Xiaoqi.text(`${badgeInfo.count} notices`, `${badgeInfo.count} 条提醒`);
    } else {
      badge.className = 'pet-badge';
      badge.textContent = '';
    }

    const balanceLabel = Xiaoqi.balanceText(state.balance);
    if (balanceLabel) {
      balance.hidden = false;
      balance.textContent = balanceLabel;
      balance.title = Xiaoqi.balanceDetail(state.balance);
    } else {
      balance.hidden = true;
      balance.textContent = '';
    }

    const emote = activeEmote();
    if (emote) {
      bubble.hidden = false;
      bubble.classList.add('is-emote');
      bubbleTitle.textContent = Xiaoqi.text('Xiaoqi', '小栖');
      bubbleDot.style.background = '#4F8CFF';
      bubbleAction.textContent = emote.speech;
      bubbleTime.textContent = '';
      hint.textContent = '';
    } else if (tasks.length === 1) {
      const task = tasks[0];
      const colors = Xiaoqi.taskColors(tasks);
      bubble.hidden = false;
      bubble.classList.remove('is-emote');
      bubbleTitle.textContent = task.title;
      bubbleDot.style.background = colors[task.id] || 'var(--accent)';
      bubbleAction.textContent = taskLine(task);
      bubbleTime.textContent = Xiaoqi.elapsedFor(task);
      hint.textContent = '';
    } else {
      bubble.hidden = true;
      bubble.classList.remove('is-emote');
      hint.textContent = tasks.length === 0
        ? (state.connected ? Xiaoqi.text('Quietly here', '安静陪伴') : Xiaoqi.text('Waiting for ZCode…', '等待 ZCode…'))
        : '';
    }

    stage.setAttribute('aria-label', tasks.length
      ? Xiaoqi.text('Xiaoqi · open task board', '小栖 · 打开任务面板')
      : Xiaoqi.text('Xiaoqi', '小栖'));
    stage.title = tasks.length
      ? Xiaoqi.text('Click to open tasks · drag to move', '点击打开任务 · 拖动移动')
      : Xiaoqi.text('Drag to move · click to open tasks', '拖动移动 · 点击打开任务');
  }

  window.xiaoqi.onState((next) => {
    state = next || { connected: false, tasks: [], balance: null, emote: null };
    render();
  });

  // 互动气泡会过期、耗时会走动：每秒重绘一次。
  setInterval(render, 1000);

  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stage.focus({ preventScroll: true });
    pointer = {
      id: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      moved: false,
    };
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      // 指针捕获只是增强。
    }
  });

  stage.addEventListener('pointermove', (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.screenX - pointer.startX;
    const dy = event.screenY - pointer.startY;
    if (!pointer.moved && Math.hypot(dx, dy) < 4) return;
    if (!pointer.moved) {
      pointer.moved = true;
      stage.classList.add('is-dragging');
      window.xiaoqi.dragStart();
    }
    window.xiaoqi.dragMove();
  });

  const finishPointer = (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const moved = pointer.moved;
    pointer = null;
    stage.classList.remove('is-dragging');
    try {
      stage.releasePointerCapture(event.pointerId);
    } catch {
      // 已释放。
    }
    if (moved) {
      suppressClick = true;
      window.xiaoqi.dragEnd();
      setTimeout(() => { suppressClick = false; }, 0);
    } else {
      window.xiaoqi.togglePanel();
    }
  };

  stage.addEventListener('pointerup', finishPointer);
  stage.addEventListener('pointercancel', (event) => {
    if (!pointer) return;
    const moved = pointer.moved;
    pointer = null;
    stage.classList.remove('is-dragging');
    if (moved) window.xiaoqi.dragEnd();
    try {
      stage.releasePointerCapture(event.pointerId);
    } catch {
      // 已释放。
    }
  });

  stage.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
    }
  });

  stage.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      window.xiaoqi.togglePanel();
    }
  });

  window.addEventListener('contextmenu', (event) => event.preventDefault());
  render();
})();
