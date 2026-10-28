# polaris-memory(ZCode 插件)

POLARIS 永久记忆 MCP —— 给 AI 编程助手装上长期记忆。

- **能力**:两级语义召回(值空间排序 + 反回声室混合读取)、空基线校准
  novelty 自动去重、GDPR 式定向遗忘、损坏存储自愈(隔离 + 文本重建)、
  跨进程共享存储零丢失。
- **商业模式**:个人用户免费,每月 **1000 次搜索额度**(自然月 1 日重置;
  写入/遗忘/统计/健康检查不消耗额度,超额返回 -32001)。企业不限额度
  版本通过授权通道提供。
- **开源**:本目录为可读源码版(v2.2.0,服务器源码见 `srv/`)。闭源
  字节码发行版由作者另行分发。

## 行为与副作用声明

- **网络访问**:默认**无任何网络请求**(无模型哈希向量器,离线可用)。
  仅当用户在 MCP 参数中显式配置 `--embedding-base-url` 时才调用远程
  OpenAI 兼容嵌入端点。
- **模型/服务依赖**:可选 `--embedding-model <BGE-small-zh 目录>`(需本机
  有 transformers 与模型文件,缺失时自动回退哈希向量器)。
- **文件写入**:记忆数据写入插件目录 `data/memory.pt`(另有 `.texts` 纯文本
  副本、`.quota.json` 配额计数与 `.log` 运行日志)。
- **命令执行**:本插件以 stdio 方式由 ZCode 启动一个本地 Python 进程
  (`python srv/polaris_mcp_server.py ...`),仅监听标准输入输出,不对外
  开放端口(HTTP 模式需显式 `--http` 参数)。
- **MCP 工具副作用**:`polaris_write`/`polaris_auto_remember` 写入记忆;
  `polaris_recall` 消耗每月搜索额度;`polaris_forget` 删除记忆。

## 安装要求

Python 3.9+(torch + numpy),Windows/macOS/Linux 均可。

## 第三方来源与许可

- 服务器运行时依赖 PyTorch(BSD 风格许可)与 NumPy(BSD 3-Clause)
- 可选语义模式依赖 transformers(Apache-2.0)与 BGE-small-zh 模型(BAAI,
  MIT 许可,需用户自行下载)
- 无其他第三方代码、素材或服务

## 反馈

问题与商务合作:通过 GitHub Issue 联系作者(POLARIS)。
