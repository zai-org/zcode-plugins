#!/usr/bin/env node
// 跨平台系统通知（零依赖）：darwin=osascript 或 terminal-notifier / win32=PowerShell WinRT toast / linux=notify-send。
// 用法：node notify.mjs <title> <subtitle> <message> [click=url|zcode]
//   click=url（默认）：点击通知打开本地面板 http://127.0.0.1:7741（面板未启动则回退打开 ZCode）
//   click=zcode：点击通知激活 ZCode（权限等待提醒——人要回到 ZCode 里去批准）
// macOS 点击/图标策略（三级）：
//   1) 已安装 terminal-notifier（brew）：-sender dev.zcode.app 归因 ZCode 图标，
//      -activate/-execute 实现点击直达，彻底摆脱「脚本编辑器」归属
//   2) 无 terminal-notifier：经运行中的 ZCode 转发 display notification（ZCode 图标，
//      点击打开 ZCode）；is running 判断不会拉起未运行的 app
//   3) ZCode 未运行且无 terminal-notifier：系统默认归属（仅图标差异，功能不受影响）
// 任何失败静默退出 0，不影响调用方。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const [title, subtitle = '', msg = '', click = 'url'] = process.argv.slice(2);
if (!msg) process.exit(0);

// 面板实际地址：serve 被占端口会顺延并把真实端口写进 usage-serve.json（事实源），点击直达才不会落空
let PANEL_URL = 'http://127.0.0.1:7741';
try {
  const m = JSON.parse(fs.readFileSync(os.homedir() + '/.zcode/usage-serve.json', 'utf8'));
  if (m && m.port) PANEL_URL = 'http://127.0.0.1:' + m.port;
} catch (e) {}
try {
  if (process.platform === 'darwin') {
    const tn = ['/opt/homebrew/bin/terminal-notifier', '/usr/local/bin/terminal-notifier']
      .find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
    if (tn) {
      // 点击行为：url=打开本地面板（未启动回退打开 ZCode）；zcode=激活 ZCode
      const execute = `open '${PANEL_URL}' || open -a ZCode`;
      const args = ['-title', title, '-subtitle', subtitle, '-message', msg, '-sender', 'dev.zcode.app'];
      if (click === 'zcode') args.push('-activate', 'dev.zcode.app');
      else args.push('-execute', execute);
      const child = spawn(tn, args, { detached: true, stdio: 'ignore' });
      child.on('error', () => {
        // 理论不可达（路径已检查）；兜底走 osascript 归因版
        spawn('osascript', ['-e',
          `tell application id "dev.zcode.app" to display notification "${msg}" with title "${title}" subtitle "${subtitle}"`],
          { detached: true, stdio: 'ignore' }).unref();
      }).unref();
    } else {
      const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      // 归因 ZCode.app：display notification 默认归属「脚本编辑器」（卷轴图标，观感差）；
      // 经 ZCode 转发后显示 ZCode 图标，点击打开 ZCode。is running 判断不会拉起未运行的 app。
      const n = `display notification "${esc(msg)}" with title "${esc(title)}" subtitle "${esc(subtitle)}"`;
      const script = 'if application id "dev.zcode.app" is running then\n' +
        `  tell application id "dev.zcode.app" to ${n}\n` +
        'else\n' + `  ${n}\n` + 'end if';
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
    }
  } else if (process.platform === 'win32') {
    // WinRT toast：PowerShell 5.1 起自带，无需任何模块；toast 归因到系统 PowerShell 应用
    const sq = (t) => String(t).replace(/'/g, "''");
    const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$t = $x.GetElementsByTagName('text')
$t.Item(0).AppendChild($x.CreateTextNode('${sq(title)}')) | Out-Null
$t.Item(1).AppendChild($x.CreateTextNode('${sq(subtitle ? subtitle + ' — ' : '')}${sq(msg)}')) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($x)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Microsoft.Windows.PowerShell').Show($toast)`;
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'linux') {
    // notify-send 无统一点击语义（桌面环境各异）：Budget/turn 类带 -A 打开面板？保持纯展示，quiet 归属应用名
    spawn('notify-send', [`--app-name=${title}`, subtitle ? `${subtitle}\n${msg}` : msg],
      { detached: true, stdio: 'ignore' }).unref();
  }
} catch (e) { /* 通知失败静默 */ }
process.exit(0);
