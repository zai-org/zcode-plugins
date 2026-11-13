# NOTICE

## Archify

本插件打包了 [Archify](https://github.com/tt-a1i/archify) v3.2.0 的运行时，位于 `vendor/archify/`，按 Apache-2.0 授权。

- `vendor/archify/LICENSE`：Archify 的 Apache-2.0 授权全文
- `vendor/archify/LICENSE-MIT`：Archify 早期的 MIT 授权，仍然有效
- `vendor/archify/NOTICE`：Archify 原始声明
- `vendor/archify/THIRD_PARTY_NOTICES.md`：Archify 收录的第三方资产与许可

Archify 的名称与标识不表示任何背书或授权关系。

## 对 Archify 的改动

按 Apache-2.0 第 4(b) 条，在此声明对打包代码的修改：

- `vendor/archify/renderers/shared/generated-brand-marks.mjs`：删除了 Jenkins、Rust、Vue.js 三个品牌标的矢量路径数据。三者在 Archify 记录的许可分别是 CC-BY-SA-3.0、CC-BY-SA-4.0、CC-BY-NC-SA-4.0，含有相同方式共享或非商业条件，与本插件的再分发方式冲突。其余 104 个品牌标按原样保留。引用这三个品牌会报 `brand/unknown`。

除上述改动外，Archify 源码未作修改。

## 其它第三方组件

- `@modelcontextprotocol/sdk`（MIT）与 `@modelcontextprotocol/ext-apps`（MIT）：构建期依赖，打包进 `dist/server.mjs` 与 `dist/ui/panel.html`。
