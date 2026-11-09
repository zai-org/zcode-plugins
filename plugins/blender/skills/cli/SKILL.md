---
name: cli
description: Create or edit Blender scenes using the official CLI and bpy, show each modeling iteration in a desktop window, and inspect preview images before deciding whether to refine the result. Also supports explicit rendering and conversion tasks.
---

# Blender CLI

使用官方 `blender` 可执行文件与普通 bpy 脚本，不创建自定义 CLI、常驻桥接或 MCP。首次使用或环境不明确时先按 [setup](../setup/SKILL.md) 检查环境。参数查 `blender --help`；建模 API 查 https://docs.blender.org/api/current/ ，无需复制整套官方教程。

## 建模流程

- 一个任务固定一个主 `.blend` 路径。新建脚本创建场景并保存；后续脚本加载该文件、修改已有对象、保存回同一路径。不要每轮新增项目副本或重复叠加整套模型。
- 建模默认打开前台窗口，不加 `--background`。通过 shell 的进程管理以非阻塞方式启动，记录自己启动的 PID、启动时间、二进制路径和项目路径；不要把持久 GUI 进程交给会超时杀进程的调用。
- 每轮脚本保存项目并生成预览图；可写一个仅在保存和渲染成功后出现的完成标记，让 Agent 区分“脚本完成、窗口保留”和“仍在执行”。清除上一轮同名标记后再启动。
- 实际用宿主图片读取工具查看预览，而不是仅检查文件存在。检查轮廓、比例、穿插、材质和构图；必要时看侧面或局部。根据图像决定是否修改，不机械地增加轮数。不能读取图片时明确说明视觉验收未完成。
- 需要修改时，CLI 无法检测已打开窗口的实时未保存状态；完成标记、文件时间戳和上一轮保存成功都不能证明窗口现在没有修改。不能依赖这些信息结束进程。
- 关闭上一轮窗口只能通过宿主提供的界面操作工具，定位本任务对应的具体窗口并走 Blender 正常关闭流程。若出现保存提示，先保存到当前项目；遇到另存路径、覆盖冲突或无法确认保存成功时停止并请用户处理，不选择丢弃。没有可靠界面操作工具、无法定位窗口或无法确认结果时，请用户保存并关闭该窗口，等待确认后再继续。不可因用户未回复而自行继续。
- 确认旧窗口已关闭、最新修改已保存后，重新加载同一项目执行调整；此前不从另一进程覆盖主项目。禁止使用 SIGTERM/SIGKILL、kill、taskkill、全应用 quit 或按名称批量关闭来替代上述流程，即便 PID 属于本任务也不例外。无需为此添加计时器或常驻状态脚本。
- 每轮窗口应有机会显示结果，不能脚本一结束就关闭。长脚本可能阻塞界面刷新；承诺的是逐轮可见结果，不是每个建模动作都实时可见。
- 最终保存后再次读取最终预览，保留最后的 Blender 窗口，交付主项目和预览。仅按用户需要导出额外格式。

示例（路径需替换；脚本负责保存和预览）：

```bash
blender --python create.py
blender project.blend --python adjust.py
```

`--python-exit-code 1` 可用于需要异常退出码的调用；GUI 保持运行时，以脚本完成标记、日志和产物判断该轮完成，不等待整个进程退出。前台脚本异常不能误报成功。

显式要求批量转换或后台渲染时，可以使用 `--background`。不要为了后台便利，省略建模任务中的前台展示与实际看图检查。所有任务都遵循已有写入授权，不为正常创建和保存重复索要确认。
