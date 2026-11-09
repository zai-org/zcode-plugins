# 公开分发格式

[English](./distribution.md)

本文档说明 ZCode 兼容插件客户端使用的公开文件格式，仅定义客户端可依赖的协议；部署基础设施和运维配置不属于公开接口。

## 目录结构

每个分发源都在基础地址（`BASE`）下提供相同的静态目录结构：

```text
BASE/
├── marketplace.json
├── assets/
│   └── <插件名>/
│       └── icon.png
└── plugins/
    └── <插件名>/
        └── <版本>/
            └── plugin.zip
```

ZCode 官方客户端会自动选择可用的受信任来源。兼容客户端应使用 ZCode 或宿主应用明确提供的市场源；不同发布渠道的仓库可见性和分发地址可能不同。

## 市场目录文档

`marketplace.json` 使用公开的 ZCode 插件市场结构，并增加安全安装 zip 制品所需的字段。

```json
{
  "name": "zcode-plugins-official",
  "description": "Official ZCode plugins marketplace.",
  "owner": { "name": "Z.ai", "url": "https://z.ai" },
  "plugins": [
    {
      "name": "example-plugin",
      "version": "0.1.1",
      "description": "A minimal template plugin.",
      "description_i18n": {
        "en": "A minimal template plugin.",
        "zh-CN": "一个最小模板插件。"
      },
      "source": {
        "source": "url",
        "type": "zip",
        "url": "https://example.invalid/plugins/example-plugin/0.1.1/plugin.zip",
        "sha256": "64 位小写十六进制摘要",
        "path": "example-plugin"
      },
      "_artifact": {
        "path": "plugins/example-plugin/0.1.1/plugin.zip",
        "sha256": "64 位小写十六进制摘要",
        "size": 12345
      }
    }
  ]
}
```

### 字段规则

- `description` 是英文兼容兜底文案。
- `description_i18n` 可提供本地化说明。客户端建议依次尝试精确 locale、语言兜底、`en` 和 `description`。
- `source: "url"` 与 `type: "zip"` 表示 URL 直接指向插件压缩包。
- `sha256` 必填；校验失败必须停止安装。
- `path` 指定压缩包内需要安装的插件目录。
- `_artifact.path` 是相对 `BASE` 的路径，方便兼容的受信任来源提供同一版本制品。
- 插件版本不可变；一个已发布版本始终对应相同内容。

`type`、`sha256`、`path` 和 `_artifact` 是 ZCode 为安全安装压缩包提供的扩展字段；不支持扩展字段的客户端应忽略未知字段，不要自行推断其含义。

## 安装流程

1. 拉取 `BASE/marketplace.json`。
2. 选择目标插件和版本。
3. 将压缩包下载到临时位置。
4. 计算 SHA-256，并与市场条目比对。
5. 校验失败时立即停止并丢弃文件。
6. 解压声明的插件目录，并通过原子替换完成安装。
7. 记录已安装版本，供后续更新检查使用。

客户端还应执行常规压缩包安全检查，包括拒绝绝对路径、父目录穿越、不安全链接，以及任何写出目标插件目录的行为。

## 可用性与缓存

- `marketplace.json` 和共享资源可能变化，应使用有界缓存。
- 带版本号的插件压缩包不可变，可以使用长期缓存。
- 当前来源不可用时，客户端可以重试其他受信任来源。
- 市场目录和插件制品都必须从受信任的 HTTPS 地址获取。

市场维护者负责发布和服务运维。贡献者在 Pull Request 中只需更新插件源码、清单、文档、版本号和根目录市场条目。

## 插件收录分类与界面能力

官方维护插件放在 `plugins/<name>`，外部团队、合作方与社区维护插件放在 `external_plugins/<name>`。发布器根据目录生成 `publisherType`（`official` 或 `community`），在 `source` 改写为 ZIP 地址后继续保留。用途分类 `category` 独立填写。外部新增提交在收录阶段检查归属；修复已有插件不改变其维护归属。

清单中合法的 `ui.surfaces` 使发布目录的 `componentTypes` 包含 `ui`，安装前即可发现界面能力。校验覆盖面板 ID、标题、已声明 MCP server、`ui://` 资源地址与 session 可用范围。能力与归属字段不授予执行权限。

现有插件（包括 CloudBase Skills、Mimosa 和 Hyper3D Rodin）暂时保留在 `plugins/`。本次保留外部新增插件的收录分类逻辑，不迁移已有插件目录。其安装包内容、版本、插件名、市场 ID 和 ZIP 路径均保持不变。
