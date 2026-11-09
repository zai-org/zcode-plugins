# Blender

[English](README.md)

Z.ai 提供的轻量引导插件，使用官方 Blender 可执行文件。不捆绑或修改 Blender，不新增自定义 CLI，不依赖 MCP 或桥接脚本。

向 Agent 说“帮我安装 Blender”或“用 Blender CLI 创建一只小乌龟”即可。`setup` Skill 负责定位、安装和验证；`cli` Skill 负责建模与看图迭代。

建模时打开前台窗口。每轮保存同一项目，Agent 实际读取预览后决定是否调整；需要调整时，借助宿主界面工具，在本任务窗口走 Blender 正常保存与关闭流程，再加载同一项目修改；无法确认时，请用户保存并关闭窗口，等待确认再继续。最终窗口保留。展示的是每轮效果，长脚本内部不保证逐步刷新。CLI 无法检测窗口实时未保存状态，之前的保存或完成标记不能作为依据。禁止用进程信号强制关闭；等待关闭时不得从另一进程覆盖项目。明确要求的批处理可在后台运行。

Blender 应用自带 CLI，无需单独安装另一套 CLI。安装需要用户明确要求或同意（包括事先同意缺少时安装），普通建模请求不等于安装授权；已有明确授权不重复询问，仍遵守宿主权限。完整流程需要可见桌面和 Agent 图片读取工具。平台安装路径不同；本插件尚未验证 Windows 和 Linux 的运行效果。

官方资料：[下载](https://www.blender.org/download/)、[命令行](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html)、[Python API](https://docs.blender.org/api/current/)。

0.4.0 替换此前的 MCP 集成，旧 MCP 工具及 host/port 配置不再生效；更新后请新建会话。无需账号或 API Key。安装过程可能下载 Blender；建模会执行本地 Python 并写入项目与预览文件。本引导沿用包的 GPL-3.0-or-later 许可，Blender 软件独立发行并遵循其上游许可。
