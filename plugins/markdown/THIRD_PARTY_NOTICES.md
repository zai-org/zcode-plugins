# Third-party notices / 第三方声明

The plugin's own source is licensed under the repository Apache-2.0 license. Dependencies retain their own licenses. 本插件源码使用仓库 Apache-2.0 许可证；依赖保留各自许可证。

| Component / 组件 | Source / 来源 | License / 许可证 |
| --- | --- | --- |
| Vditor 3.11.1 | https://github.com/Vanessa219/vditor | MIT |
| diff-match-patch 1.0.5 (in Vditor) | https://github.com/JackuB/diff-match-patch | Apache-2.0 |
| Lute (distributed with Vditor) | https://github.com/88250/lute | MulanPSL-2.0 |
| KaTeX, including packaged fonts | https://github.com/KaTeX/KaTeX | MIT |
| mhchem parser | https://github.com/mhchem/mhchemParser | Apache-2.0 |
| Mermaid 11.6.0 | https://github.com/mermaid-js/mermaid | MIT; bundled dependency notices preserved |
| DOMPurify (in Mermaid) | https://github.com/cure53/DOMPurify | Apache-2.0 OR MPL-2.0 |
| highlight.js 11.7.0 and language/theme assets | https://github.com/highlightjs/highlight.js | BSD-3-Clause |
| Ant Design icons | https://github.com/ant-design/ant-design-icons | MIT |
| MCP TypeScript SDK 1.x, MCP Apps SDK | https://github.com/modelcontextprotocol | MIT |
| MCP client/core 2.x | https://github.com/modelcontextprotocol | MIT or Apache-2.0, per exact package/version |
| Zod | https://github.com/colinhacks/zod | MIT |

Builds copy the complete license texts of bundled npm modules to `dist/licenses/`. Its `packages.json` records the exact bundled package versions, licenses, and copied notice filenames, without build-machine paths. The build fails if a bundled npm package has no license text. Vditor's renderer/icon assets come from the pinned npm release; their license texts, preserved Mermaid notices, and upstream source links are in `dist/licenses/assets/`. CSS font URLs are converted to data URLs for offline use; the font contents are unchanged. The unused Material icon set is not packaged.

构建会将打包所用 npm 模块的完整许可证复制到 `dist/licenses/`，其中 `packages.json` 记录精确版本、许可证和声明文件名，不包含构建机器路径。缺少许可证文本时构建失败。Vditor 渲染器与图标资源来自固定版本的 npm 发布包，其许可证、保留的 Mermaid 声明与上游来源链接在 `dist/licenses/assets/`。为离线使用，CSS 字体链接被转换成 data URL，字体内容不变。不打包未使用的 Material 图标集。

Development-only tools include esbuild (MIT), TypeScript (Apache-2.0), Playwright (Apache-2.0), Vitest (MIT), and Oxlint (MIT). They are not installed as runtime dependencies of the packaged plugin. Development dependencies and integrity hashes are pinned in the root pnpm lockfile.

仅用于开发的工具包括 esbuild（MIT）、TypeScript（Apache-2.0）、Playwright（Apache-2.0）、Vitest（MIT）、Oxlint（MIT），不会作为插件安装包的运行时依赖安装。开发依赖与完整性哈希由仓库根目录 pnpm lockfile 固定。
