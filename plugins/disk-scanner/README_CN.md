# disk-scanner

[English](./README.md)

本地优先的 Windows 磁盘空间分析插件。对 agent 说"扫描C盘""看看哪里占空间"，它会跑只读扫描给出体积分析，清理动作一律先列清单、经你确认后才执行。

## 功能

- **目录体积排行** — 遍历目录树按体积排序，自动跳过符号链接/junction，权限错误优雅处理。
- **文件类型分布** — 按扩展名统计体积并画条形图（前 15）。
- **最大文件清单** — 可配置 top-N，人类可读大小（B/KB/MB/GB/TB）。
- **清理分析**（clean_scan.py）— 识别缓存/临时文件/日志等候选，附安全说明。
- **安全清理**（safe_clean.py）— 只删除用户明确确认过的路径，绝不触碰系统目录。

## 目录结构

```text
disk-scanner/
├── .zcode-plugin/
│   └── plugin.json
└── skills/
    └── disk-scanner/
        ├── SKILL.md
        └── scripts/
            ├── disk_scan.py     # 只读扫描：体积、类型分布、大文件
            ├── clean_scan.py    # 找缓存/临时/日志清理候选
            ├── game_scan.py     # 定位游戏安装目录及体积
            └── safe_clean.py    # 仅在明确确认后删除
```

## 副作用说明

| 副作用 | 详情 |
| --- | --- |
| 文件读取 | 读取所扫盘符的目录元数据与文件大小。 |
| 文件写入 | 扫描过程零写入；safe_clean.py 仅删除用户确认的路径。 |
| 网络访问 | 无，全部分析在本地完成。 |
| 命令执行 | 运行内置 Python 脚本（仅标准库，无第三方依赖）。 |

## 环境要求

- Windows（任意近期版本）
- Python 3.8+

## 作者

wdfdsyhb · [源码仓库](https://github.com/wdfdsyhb/zcode-plugins-community)
