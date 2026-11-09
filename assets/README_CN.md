# 共享静态资源（图标等）

[English](README.md)

本目录下的文件会在合入 main 时由发布流水线按原目录结构同步到 OSS/CDN：

```
assets/<plugin-name>/icon.png
  -> https://cdn-zcode.z.ai/zcode/official-plugin/assets/<plugin-name>/icon.png
```

客户端 / 市场条目里直接引用 CDN URL，例如：

```
icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/android-emulator/icon.png"
```

约定：

- 每个插件一个子目录，目录名与插件名一致（kebab-case）。
- 图标：`icon.png`，正方形，建议 256×256（或更大的 2 的幂）。
- 支持实色或透明背景；圆角裁切由客户端负责。
- `tests/test_icon_assets.py` 统一检查 PNG 完整性、正方形画布、CDN 引用和来源哈希。
  单个插件测试不再固定尺寸、透明通道或图片哈希；修改已记录资产时同步更新 `icon-sources.json`。
- 资源是**可变的**：同路径提交新内容会原地重新上传并刷新 CDN 缓存
  （浏览器缓存最长 1 小时过期）。
- 从本目录删除文件**不会**删除 OSS 上的对象；确有需要时手动清理。
- 点开头的文件和这两个 README 不会被上传。
