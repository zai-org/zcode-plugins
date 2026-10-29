'use strict';

(() => {
  const Xiaoqi = window.Xiaoqi;
  const scroll = document.getElementById('scroll');
  const summary = document.getElementById('summary');
  const live = document.getElementById('live');
  const liveLabel = document.getElementById('live-label');
  const appName = document.getElementById('app-name');
  const foot = document.getElementById('foot');

  let state = { connected: false, tasks: [] };

  const symbols = {
    read: '▤', write: '▤', edit: '▤', bash: '▣',
    glob: '⌕', grep: '⌕', image: '▧',
    search: '◎', fetch: '◎', subagent: '◫',
    workflow: '⌁', skill: '✦', todo: '☷',
    schedule: '◷', question: '?', plan: '◈', mcp: '⇄', tool: '•',
  };

  function section(label, tasks, colorMap) {
    if (!tasks.length) return '';
    const cards = tasks.map((task) => card(task, colorMap[task.id] || '#2a8a80')).join('');
    return `<section class="task-section">
      <div class="task-section-label"><span>${Xiaoqi.escapeHtml(label)}</span><span class="task-section-count">${tasks.length}</span></div>
      ${cards}
    </section>`;
  }

  function card(task, color) {
    const progress = task.progress || {};
    const action = progress.action || null;
    const symbol = action && action.failed ? '✗' : (symbols[action && action.kind] || '•');
    const headline = Xiaoqi.taskHeadline(task);
    const todo = Xiaoqi.todoLine(task);
    const todoCount = Xiaoqi.todoCount(task);
    const trail = Xiaoqi.trail(task);
    const meta = [task.project, Xiaoqi.statusText(task)].filter(Boolean).map(Xiaoqi.escapeHtml).join(' · ');
    const todoHtml = todo
      ? `<div class="card-todo"><span class="card-todo-label">${Xiaoqi.escapeHtml(todo)}</span><span class="card-todo-count">${Xiaoqi.escapeHtml(todoCount)}</span></div>`
      : '';
    const trailHtml = trail
      ? `<span class="card-trail">${Xiaoqi.escapeHtml(trail)}</span>`
      : '';
    return `<button class="task-card" type="button" data-task-id="${Xiaoqi.escapeHtml(task.id)}" style="--task-color:${Xiaoqi.escapeHtml(color)}">
      <span class="card-title-line">
        <span class="card-dot"></span>
        <span class="card-title">${Xiaoqi.escapeHtml(task.title)}</span>
        <span class="card-state">${Xiaoqi.escapeHtml(Xiaoqi.statusText(task))}</span>
      </span>
      <span class="card-meta">${meta}</span>
      ${todoHtml}
      <span class="card-action">
        <span class="card-action-symbol">${symbol}</span>
        <span class="card-action-label">${Xiaoqi.escapeHtml(headline)}</span>
        <span class="card-time">${Xiaoqi.escapeHtml(Xiaoqi.elapsedFor(task))}</span>
      </span>
      ${trailHtml}
    </button>`;
  }

  function render() {
    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    appName.textContent = Xiaoqi.isZh ? '小栖' : 'Xiaoqi';
    liveLabel.textContent = Xiaoqi.isZh ? '实时' : 'LIVE';
    live.classList.toggle('active', state.connected);
    summary.textContent = state.connected
      ? Xiaoqi.summary(tasks)
      : (tasks.length ? Xiaoqi.summary(tasks) : (Xiaoqi.isZh ? '等待 ZCode hook 事件…' : 'Waiting for ZCode hooks…'));
    foot.textContent = tasks.length
      ? (Xiaoqi.isZh ? '点击任务卡片把 ZCode 调到前台' : 'Click a task to bring ZCode to the front')
      : (Xiaoqi.isZh ? '小栖会在这里显示任务进展' : 'Xiaoqi will show task progress here');

    if (!tasks.length) {
      scroll.innerHTML = `<div class="empty-state">
        <div class="empty-mark">✦</div>
        <div class="empty-title">${Xiaoqi.isZh ? '所有会话都安静了' : 'All sessions are quiet'}</div>
        <div class="empty-copy">${Xiaoqi.isZh ? '任务开始运行或需要你处理时，小栖会提醒你。' : 'Xiaoqi will speak up when a task starts or needs you.'}</div>
      </div>`;
      return;
    }

    const colors = Xiaoqi.taskColors(tasks);
    const waiting = tasks.filter((task) => task.kind === 'waiting');
    const running = tasks.filter((task) => task.kind === 'running');
    const done = tasks.filter((task) => task.kind === 'done');
    scroll.innerHTML = [
      section(Xiaoqi.isZh ? '需要你' : 'Needs you', waiting, colors),
      section(Xiaoqi.isZh ? '进行中' : 'In progress', running, colors),
      section(Xiaoqi.isZh ? '刚完成' : 'Just finished', done, colors),
    ].join('');

    for (const node of scroll.querySelectorAll('.task-card')) {
      node.addEventListener('click', () => {
        const id = node.getAttribute('data-task-id');
        if (id) window.xiaoqi.openTask(id);
      });
    }
  }

  document.getElementById('close').addEventListener('click', () => window.xiaoqi.closePanel());
  window.xiaoqi.onState((next) => {
    state = next || { connected: false, tasks: [] };
    render();
  });
  setInterval(render, 1000);
  render();
})();
