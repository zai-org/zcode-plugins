---
name: db-admin-generator
description: 给 SQLite 数据库生成无依赖的管理后台（Node.js + 网页界面：登录、admin/editor/viewer 角色、搜索、筛选、表单校验、增删改查），并用数据库的临时副本自动启动自测。用户提到“管理后台 / 后台管理系统 / admin panel / 给数据库做个界面 / CRUD”时使用。
---

# 数据库转管理后台

1. 找到 SQLite 文件（.db / .sqlite / .sqlite3）。如果用户说的是 Postgres 或 MySQL，告诉他这一版只支持 SQLite；可以先导出一份 SQLite 测试库。
2. 用 `db_inspect({db})` 读取表结构，向用户简要说明有哪些表和视图、行数、引用关系，以及默认隐藏的敏感列（密码、令牌等）。
3. 和用户确认：要管理哪些表、每张表允许哪些操作、editor 和 viewer 能做什么、界面语言和标题。然后调用 `db_generate({db, only?, tables?, roles?, lang?, title?})`。
4. 查看自测结果。如果有失败项，说明是哪一项、可能的原因（例如数据库里的触发器或 CHECK 约束），必要时调整方案后重新生成。
5. 告诉用户怎么运行：`cd <out> && node server.mjs`（需要 Node 22.13+），第一次启动会在终端打印 admin 的密码；用 `node server.mjs user add <名字> <角色>` 添加其他人。默认只能本机访问；要给别人用，需要先放到 HTTPS 后面。
6. 用户手动改过生成的代码后，可以用 `db_selftest({out})` 再验证一遍。
