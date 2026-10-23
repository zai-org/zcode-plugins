#!/usr/bin/env python3
"""框架级 co-change 规则库。

来源：社区工具 Chameleon 的实践 + 学术界 evolutionary coupling 研究。
这些是"改A必改B"的确定性规则——不需要历史数据就能知道。

用途：
  1. /regress:plan 时提示"改了A别忘了B"
  2. /regress:track 时发现"改了A但没改B"→ 警告 missing co-change
  3. /regress:learn 冷启动时作为预置知识

规则格式：
  {
    "framework": "Django",
    "detect": "models.py 中有 class(Model)"  # 怎么检测项目用了这个框架
    "rules": [
      {
        "trigger": "**/models.py",      # 改了这个文件
        "expect": "**/migrations/*.py", # 应该同时改这个
        "message": "Django model 改动需要配套 migration"
      }
    ]
  }
"""

# ─── 规则定义 ──────────────────────────────────────────

FRAMEWORK_RULES = [
    # Django
    {
        "framework": "Django",
        "detect_files": ["manage.py", "settings.py"],
        "detect_patterns": ["from django", "import django"],
        "rules": [
            {
                "trigger_pattern": "models.py",
                "expect_pattern": "migrations/",
                "message": "Django model 改动通常需要配套 migration（python manage.py makemigrations）",
                "severity": "high",
            },
            {
                "trigger_pattern": "settings.py",
                "expect_pattern": "requirements.txt",
                "message": "改 settings.py 中的 INSTALLED_APPS 可能需要更新 requirements.txt",
                "severity": "low",
            },
            {
                "trigger_pattern": "urls.py",
                "expect_pattern": "views.py",
                "message": "Django urls.py 新增路由通常需要配套 view",
                "severity": "medium",
            },
        ],
    },
    # Rails
    {
        "framework": "Rails",
        "detect_files": ["Gemfile", "config/routes.rb"],
        "detect_patterns": ["Rails.application", "ActiveRecord"],
        "rules": [
            {
                "trigger_pattern": "app/models/",
                "expect_pattern": "db/migrate/",
                "message": "Rails model 改动通常需要配套 migration",
                "severity": "high",
            },
            {
                "trigger_pattern": "app/controllers/",
                "expect_pattern": "config/routes.rb",
                "message": "Rails controller 新增 action 通常需要在 routes.rb 注册路由",
                "severity": "high",
            },
            {
                "trigger_pattern": "app/models/",
                "expect_pattern": "spec/models/ 或 test/models/",
                "message": "Rails model 改动通常需要配套测试",
                "severity": "medium",
            },
        ],
    },
    # NestJS
    {
        "framework": "NestJS",
        "detect_files": ["nest-cli.json"],
        "detect_patterns": ["@Module", "@Controller", "@nestjs"],
        "rules": [
            {
                "trigger_pattern": ".controller.ts",
                "expect_pattern": ".module.ts",
                "message": "NestJS controller 必须注册到对应的 module",
                "severity": "high",
            },
            {
                "trigger_pattern": ".service.ts",
                "expect_pattern": ".module.ts",
                "message": "NestJS service 必须注册到 module 的 providers",
                "severity": "high",
            },
        ],
    },
    # Spring Boot / Java
    {
        "framework": "Spring Boot",
        "detect_files": ["pom.xml", "build.gradle"],
        "detect_patterns": ["@SpringBootApplication", "@RestController", "org.springframework"],
        "rules": [
            {
                "trigger_pattern": "entity/",
                "expect_pattern": "repository/",
                "message": "Spring Entity 改动通常需要检查 Repository",
                "severity": "medium",
            },
            {
                "trigger_pattern": "controller/",
                "expect_pattern": "service/",
                "message": "Spring Controller 改动通常需要检查 Service 层",
                "severity": "medium",
            },
            {
                "trigger_pattern": "entity/",
                "expect_pattern": "resources/db/migration/ 或 resources/mapper/",
                "message": "Entity 字段改动可能需要 DB migration 或 MyBatis mapper 更新",
                "severity": "high",
            },
            {
                "trigger_pattern": "pom.xml",
                "expect_pattern": None,
                "message": "pom.xml 依赖改动需要 mvn clean install 确认编译通过",
                "severity": "low",
            },
        ],
    },
    # React / Redux
    {
        "framework": "Redux",
        "detect_files": [],
        "detect_patterns": ["createSlice", "configureStore", "@reduxjs/toolkit"],
        "rules": [
            {
                "trigger_pattern": "slice.ts 或 slice.js",
                "expect_pattern": "store.ts 或 store.js",
                "message": "Redux slice 新增必须注册到 store",
                "severity": "high",
            },
        ],
    },
    # Go
    {
        "framework": "Go",
        "detect_files": ["go.mod"],
        "detect_patterns": ["package main", "go.mod"],
        "rules": [
            {
                "trigger_pattern": "handler 或 controller",
                "expect_pattern": "router 或 route",
                "message": "Go handler 改动通常需要检查路由注册",
                "severity": "medium",
            },
        ],
    },
    # Next.js
    {
        "framework": "Next.js",
        "detect_files": ["next.config.js", "next.config.mjs"],
        "detect_patterns": ["next/", "next/image", "next/link"],
        "rules": [
            {
                "trigger_pattern": "app/api/ 或 pages/api/",
                "expect_pattern": None,
                "message": "Next.js API route 改动需要确认前端调用方同步更新",
                "severity": "medium",
            },
        ],
    },
    # 通用规则（任何框架）
    {
        "framework": "通用",
        "detect_files": [],
        "detect_patterns": [],
        "rules": [
            {
                "trigger_pattern": ".env.example 或 application.yml",
                "expect_pattern": "README 或部署文档",
                "message": "配置文件改动需要同步更新文档",
                "severity": "low",
            },
            {
                "trigger_pattern": "package.json 的 dependencies",
                "expect_pattern": "package-lock.json 或 yarn.lock",
                "expect_auto": True,  # npm install 会自动更新
                "message": "依赖改动需要重新 install（lock 文件会自动更新）",
                "severity": "low",
            },
        ],
    },
]


def detect_framework(project_dir):
    """检测项目用了什么框架。返回匹配的框架规则列表。"""
    import os
    import glob
    matched = []

    for fw in FRAMEWORK_RULES:
        # 检测文件
        found = False
        for pattern in fw.get("detect_files", []):
            if glob.glob(os.path.join(project_dir, "**", pattern), recursive=True):
                found = True
                break

        # 如果文件没匹配，检测内容模式（只检查根目录的关键文件）
        if not found and fw.get("detect_patterns"):
            for check_file in ("package.json", "pom.xml", "build.gradle",
                               "go.mod", "Gemfile", "requirements.txt",
                               "manage.py", "settings.py"):
                fp = os.path.join(project_dir, check_file)
                if os.path.exists(fp):
                    try:
                        with open(fp, encoding="utf-8") as f:
                            content = f.read()[:5000]
                        for pattern in fw["detect_patterns"]:
                            if pattern in content:
                                found = True
                                break
                    except (IOError, OSError):
                        pass
                if found:
                    break

        if found:
            matched.append(fw)

    # 通用规则总是包含
    for fw in FRAMEWORK_RULES:
        if fw["framework"] == "通用":
            matched.append(fw)

    return matched


def check_cochange(changed_files, project_dir):
    """检查改动的文件是否有 missing co-change。

    Args:
        changed_files: 本次改动的文件列表
        project_dir: 项目根目录

    Returns:
        list of {trigger, expect, message, severity, missing: bool}
    """
    import fnmatch

    frameworks = detect_framework(project_dir)
    warnings = []

    for fw in frameworks:
        for rule in fw.get("rules", []):
            trigger = rule["trigger_pattern"]
            expect = rule.get("expect_pattern")

            # 检查是否触发了规则（改了 trigger 文件）
            triggered = any(
                fnmatch.fnmatch(f, f"*{trigger}*") or trigger in f
                for f in changed_files
            )

            if not triggered:
                continue

            # 如果 expect 为 None，只提示不检查
            if expect is None or rule.get("expect_auto"):
                warnings.append({
                    "framework": fw["framework"],
                    "trigger": trigger,
                    "expect": expect or "(无配套文件检查)",
                    "message": rule["message"],
                    "severity": rule["severity"],
                    "missing": False,
                    "note": "提示",
                })
                continue

            # 检查 expect 文件是否也在改动列表中
            has_expect = any(
                fnmatch.fnmatch(f, f"*{expect}*") or expect in f
                for f in changed_files
            )

            if not has_expect:
                warnings.append({
                    "framework": fw["framework"],
                    "trigger": trigger,
                    "expect": expect,
                    "message": rule["message"],
                    "severity": rule["severity"],
                    "missing": True,
                    "note": f"改了 {trigger} 但没看到 {expect} 的改动",
                })

    return warnings


if __name__ == "__main__":
    import sys
    import json
    project_dir = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    changed = sys.argv[2].split(",") if len(sys.argv) > 2 else []

    if changed:
        # 检查 missing co-change
        result = check_cochange(changed, project_dir)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        # 只检测框架
        frameworks = detect_framework(project_dir)
        print(json.dumps(
            [{"framework": f["framework"], "rules": len(f.get("rules", []))}
             for f in frameworks],
            ensure_ascii=False, indent=2
        ))
