# 护网/安全岗面试验点

## 考察逻辑（三条）

1. **背流程题是定级门槛**：打点流程、应急六步、内网思路——答顺了就过初筛
2. **红蓝对照出题**：同一考点两边考（webshell 红队问免杀、蓝队问检测；反制/蜜罐蓝队必考）——本质是岗位角色适配测试
3. **高频洞+端口表是硬通货**：开口就要能报菜名，答错直接暴露没打过实战

开场必问：工作经历+有无护网经历，没有一般定初级。学生打 HW 从蓝队监控位切入最现实。

## 红队高频题

| 问题 | 答案要点 |
|------|----------|
| 外网打点流程 | 靶标确认→信息收集→漏洞探测→利用→权限获取，信息收集最关键 |
| FOFA 技巧 | title/body/host 组合挖后台、子域、C 段、框架特征、列目录漏洞 |
| 识别 CDN | ping 回显、nslookup 解析、超级 ping 看多地区 IP 是否一致 |
| 判断 Win/Linux | 大小写敏感差异 + TTL（Windows>100、Linux<100） |
| Windows 隐藏用户 | `net user test$ /add` + administrators 组 |
| Windows 提权 | 内核溢出、数据库提权、错误配置、中间件漏洞、第三方软件 |
| Linux 提权 | 内核漏洞、SUID、环境变量劫持、sudoer 配置 |
| 正反 shell | 正向=攻击者连目标（目标有公网）；反向=目标主动回连（目标在内网） |
| PHP 危险函数 | system/exec/shell_exec/passthru/pcntl_exec；eval/call_user_func/create_function/array_map/assert/proc_open/popen/putenv |
| disable_functions 绕过 | pcntl_exec、putenv+LD_PRELOAD、imap_open、FastCGI、ImageMagick |
| Webshell 工具区别 | 冰蝎=流量动态加密；菜刀/蚁剑特征明显 |
| SQL 注入分类 | 注入点（数字/字符/搜索）、提交方式（GET/POST/Cookie/头）、结果（报错/布尔/时间/联合/堆叠/宽字节/二次/万能密码） |
| SQL 注入预防 | 预编译、PDO、正则过滤 |
| 序列化/反序列化 | 对象→字节序列 / 字节序列→对象；PHP unserialize、Java readObject |
| 内网渗透思路 | 代理穿透、权限维持、信息收集、口令爆破、凭据窃取、横纵渗透、拿域控 |
| Log4j2 原理 | 日志处理 JNDI 注入 `${jndi:ldap://}` → 任意代码执行 |
| 水坑 vs 鱼叉 | 水坑=攻目标常访问网站等上钩；鱼叉=定向邮件附件 |

## 中间件漏洞报菜名

| 中间件 | 漏洞 |
|--------|------|
| IIS | PUT 上传、解析（`;`、目录）、短文件名枚举 |
| Apache | 解析（`1.php.xxx`）、SSI、路径穿越 |
| Nginx | 解析（cgi.fix_pathinfo）、CRLF、alias 穿越 |
| Tomcat | PUT（CVE-2017-12615）、manager 弱口令 war、examples |
| WebLogic | T3 反序列化、SSRF（CVE-2014-4210）、弱口令 |
| JBoss | 反序列化、JMX 未授权 |
| Shiro | rememberMe 反序列化（550 硬编码 key / 721 padding oracle） |
| ThinkPHP | 5.x RCE |
| Spring | Actuator 未授权、Spring4Shell |

## 未授权访问清单

MongoDB、Redis、Memcached、VNC、Docker、Zookeeper、Rsync、Jenkins、Elasticsearch、Hadoop、CouchDB、Kibana。

## 数据库默认端口

MySQL 3306 / SQLServer 1433 / Oracle 1521 / Redis 6379 / Memcached 11211 / MongoDB 27017 / PostgreSQL 5432。

## 蓝队高频题

| 问题 | 答案要点 |
|------|----------|
| 应急响应流程 | 准备→检测→抑制→根除→恢复→报告（六步） |
| webshell 检测工具 | D 盾、河马、findwebshell、CloudWalker；静态+流量双检 |
| 威胁情报平台 | 微步在线、奇安信 TI、绿盟 NTI、VirusTotal、AbuseIPDB |
| 蓝队反制 | 蜜罐、反渗透（IP 反查身份）、反钓鱼（邮件上报） |
| 判定失陷 | 告警日志 + 外连行为关联（Webshell=200 OK 访问；挖矿=mining.subscribe；永恒之蓝=doublepulsar） |
| 应急排查位置 | /var/tmp、Downloads、tomcat-users.xml、_WL_internal、上传目录；Tcpview/AutoRuns/D 盾/LogParser |
| 安全设备职责 | NTI=情报、IPS=阻断、WAF=Web 防护、TAC=沙箱、UTS/TAM=全流量取证、ESPC=统一管理（见 blue-team.md 表） |

## 准备建议

- 讲一个**完整链路案例**比背十个名词有效（如：crt.sh 挖子域→Github 找接口代码→fastjson 进内网）
- 蓝队监控位要熟：告警研判思路（真攻击/误报/扫描三分法）、上报要素（源 IP+流量+样本）、设备产品线
- 红队初级要熟：打点流程+高频洞清单+一个完整 getshell 链路
- 参加过 SQL/XSS/WAF 挑战赛=动手能力证明
