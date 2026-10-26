# 外部插件

[English](./README.md)

本目录用于收录外部团队、合作方和社区插件。每个插件放在 `external_plugins/<name>/` 下，并在根目录的 [marketplace.json](../marketplace.json) 中注册。

发布器根据本目录生成 `publisherType: community`。用途分类 `category` 和组件能力与发布者分类相互独立。外部插件与其他插件使用同一份市场目录和 ZIP 分发流程。

Excalidraw、OpenPencil 和全部 9 个 Craft 插件由 `zcoder` 维护，收录于本目录。其他官方插件保留在 `plugins/`。这两份 README 是目录说明，不是可安装的插件。

新增插件前，请阅读[贡献指南](../CONTRIBUTING_CN.md)、[插件开发指南](../docs/PLUGIN_DEVELOPMENT_CN.md)和[分发约定](../docs/distribution_CN.md)。
