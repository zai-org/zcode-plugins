# -*- coding: utf-8 -*-
"""模型 token 单价表与预估费用计算（v202）。

数据链：内置 PRICING（scripts/sync_token_pricing.py 从 models.dev 增量同步烘焙）
+ 运行时覆盖层（serve 常驻进程内 12h 定时拉 models.dev 与 USD→CNY 汇率，落盘
运行目录 pricing-cache.json；拉取失败/结构校验不过静默保留旧值）。
费用口径（本库 model_usage 特有，勿照抄外部 dsh 口径）：input_tokens 已含
cache_read 与 cache_creation、output_tokens 已含 reasoning，因此
    裸输入     = max(0, input − cache_read − cache_creation)   # 全价
    cost_usd  = (裸输入×input + cache_read×cache_read + cache_creation×cache_write
                 + output×output) ÷ 1e6
单价 USD/百万 token；表内缺费率字段按 0 计（供应商标"缓存不计费"）；
模型未命中按 DEFAULT_RATES 兜底均价估算（用户选定口径，可能偏差一个数量级）。
一次性 CLI（json 子命令）只读不拉网；config pricing.fetch=false 彻底关闭联网。
币种换算不在本模块：快照只带 cost_usd 原值与 fx 汇率，¥ 在展示层相乘。
"""
import json
import math
import os
import re
import threading
import time
import urllib.request
from pathlib import Path

PRICING_URL = "https://models.dev/api.json"
FX_URL = "https://open.er-api.com/v6/latest/USD"
# 主汇率源失败时的兜底（FreeExchangeRateApi 公益接口，rates.CNY 同形；仅在用户未
# 自定义 pricing.fx.url 时启用——显式配置的源失败应保持失败，不擅自打第三方）
FX_FALLBACK_URL = "https://api.exchangerate.fun/latest?base=USD"
FETCH_TIMEOUT_S = 10.0
SYNC_INTERVAL_S = 12 * 3600        # 12h 定时同步（用户设定）
PRICING_TTL_MS = SYNC_INTERVAL_S * 1000
CACHE_VERSION = 1
# 兜底均价（juejin-usage 同款）：未匹配模型按此估算而非计 0
DEFAULT_RATES = {"input": 1.0, "output": 5.0, "cache_read": 0.1, "cache_write": 1.25}

# ---- models.dev 官方渠道白名单（与 scripts/sync_token_pricing.py 共用）----
# 只收第一方官方渠道；coding-plan 通道条目多为套餐内含（cost 全 0），整族排除，
# 其高速变体由同步脚本按同厂基础模型派生牌价。
OFFICIAL_PROVIDERS = frozenset((
    "anthropic", "openai", "google", "xai", "deepseek",
    "alibaba", "alibaba-cn", "moonshotai", "moonshotai-cn",
    "minimax", "minimax-cn", "zai", "zhipuai", "xiaomi",
    "stepfun", "mistral", "meta", "volcengine", "cohere",
))
# 各 provider 只收自家模型家族（剔除云中转代售：volcengine 卖 deepseek、alibaba 卖 glm 等）
PROVIDER_FAMILIES = {
    "volcengine": ("doubao", "seed"),
    "alibaba": ("qwen", "qwq", "wan"),
    "alibaba-cn": ("qwen", "qwq", "wan"),
}
EXCLUDE_ID_RE = re.compile(
    r"embed|rerank|transcri|audio|video|image|imagen|tts|speech|realtime|"
    r"moderation|guard|diffusion|sora|veo|whisper", re.I)


def is_syncable_model(model_id, info):
    """models.dev 模型条目是否收进价表：须有有限非负的 input/output 牌价、
    输入模态含文本（无 modalities 字段视为文本）、id 不含非文本家族关键词。"""
    cost = info.get("cost") if isinstance(info, dict) else None
    if not isinstance(cost, dict):
        return False
    for k in ("input", "output"):
        v = cost.get(k)
        if not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
            return False
    mods = info.get("modalities") if isinstance(info, dict) else None
    if isinstance(mods, dict) and mods.get("input") and "text" not in mods["input"]:
        return False
    return not EXCLUDE_ID_RE.search(model_id or "")


def rates_of(cost):
    """models.dev cost 对象 → 四价 dict（USD/百万 token）。缺字段按 0（该维度不计费）。"""
    out = {}
    for k in ("input", "output", "cache_read", "cache_write"):
        v = (cost or {}).get(k)
        out[k] = round(float(v), 6) if isinstance(v, (int, float)) and math.isfinite(v) and v >= 0 else 0.0
    return out


def convert_models_dev(data):
    """models.dev api.json → {「provider/model」(小写): 四价}；只收白名单官方渠道。"""
    out = {}
    if not isinstance(data, dict):
        return out
    for prov, pdata in data.items():
        if prov not in OFFICIAL_PROVIDERS or not isinstance(pdata, dict):
            continue
        fam = PROVIDER_FAMILIES.get(prov)
        for mid, info in (pdata.get("models") or {}).items():
            if not isinstance(info, dict):
                continue
            if fam and not str(mid).lower().startswith(fam):
                continue
            if not is_syncable_model(mid, info):
                continue
            out[prov.lower() + "/" + str(mid).lower()] = rates_of(info.get("cost"))
    return out


# ---------------------------------------------------------------------------
# BEGIN PRICING DATA —— scripts/sync_token_pricing.py 生成段（勿手工改单条；
PRICING = {
 "alibaba-cn/qwen-deep-research": {"cache_read": 0.0, "cache_write": 0.0, "input": 7.742, "output": 23.367},
 "alibaba-cn/qwen-doc-turbo": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.087, "output": 0.144},
 "alibaba-cn/qwen-flash": {"cache_read": 0.0044, "cache_write": 0.0275, "input": 0.022, "output": 0.216},
 "alibaba-cn/qwen-long": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.072, "output": 0.287},
 "alibaba-cn/qwen-math-plus": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.574, "output": 1.721},
 "alibaba-cn/qwen-math-turbo": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.287, "output": 0.861},
 "alibaba-cn/qwen-max": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.345, "output": 1.377},
 "alibaba-cn/qwen-mt-plus": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.259, "output": 0.775},
 "alibaba-cn/qwen-mt-turbo": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.101, "output": 0.28},
 "alibaba-cn/qwen-omni-turbo": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.058, "output": 0.23},
 "alibaba-cn/qwen-plus": {"cache_read": 0.023, "cache_write": 0.144, "input": 0.115, "output": 0.287},
 "alibaba-cn/qwen-plus-character": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.115, "output": 0.287},
 "alibaba-cn/qwen-turbo": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.044, "output": 0.087},
 "alibaba-cn/qwen-vl-max": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.23, "output": 0.574},
 "alibaba-cn/qwen-vl-ocr": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.043, "output": 0.072},
 "alibaba-cn/qwen-vl-plus": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.115, "output": 0.287},
 "alibaba-cn/qwen2-5-omni-7b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.087, "output": 0.345},
 "alibaba-cn/qwen3-14b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.144, "output": 0.574},
 "alibaba-cn/qwen3-235b-a22b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.287, "output": 1.147},
 "alibaba-cn/qwen3-32b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.287, "output": 1.147},
 "alibaba-cn/qwen3-8b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.072, "output": 0.287},
 "alibaba-cn/qwen3-coder-30b-a3b-instruct": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.216, "output": 0.861},
 "alibaba-cn/qwen3-coder-480b-a35b-instruct": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.861, "output": 3.441},
 "alibaba-cn/qwen3-coder-flash": {"cache_read": 0.0288, "cache_write": 0.18, "input": 0.144, "output": 0.574},
 "alibaba-cn/qwen3-coder-plus": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.574, "output": 2.296},
 "alibaba-cn/qwen3-max": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.359, "output": 1.434},
 "alibaba-cn/qwen3-next-80b-a3b-instruct": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.144, "output": 0.574},
 "alibaba-cn/qwen3-next-80b-a3b-thinking": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.144, "output": 1.434},
 "alibaba-cn/qwen3-omni-flash": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.258, "output": 0.989},
 "alibaba-cn/qwen3-vl-235b-a22b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.286705, "output": 1.14682},
 "alibaba-cn/qwen3-vl-30b-a3b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.108, "output": 0.431},
 "alibaba-cn/qwen3-vl-plus": {"cache_read": 0.028671, "cache_write": 0.179191, "input": 0.143353, "output": 1.433525},
 "alibaba-cn/qwen3.5-397b-a17b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.172, "output": 1.032},
 "alibaba-cn/qwen3.5-flash": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.029, "output": 0.287},
 "alibaba-cn/qwen3.5-plus": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.115, "output": 0.688},
 "alibaba-cn/qwen3.6-flash": {"cache_read": 0.0165, "cache_write": 0.20625, "input": 0.165, "output": 0.99},
 "alibaba-cn/qwen3.6-max-preview": {"cache_read": 0.132, "cache_write": 0.0, "input": 1.32, "output": 7.9},
 "alibaba-cn/qwen3.6-plus": {"cache_read": 0.0276, "cache_write": 0.345, "input": 0.276, "output": 1.651},
 "alibaba-cn/qwen3.7-flash": {"cache_read": 0.005924, "cache_write": 0.03703, "input": 0.02962, "output": 0.1185},
 "alibaba-cn/qwen3.7-max": {"cache_read": 0.33, "cache_write": 2.0625, "input": 1.65, "output": 4.951},
 "alibaba-cn/qwen3.7-plus": {"cache_read": 0.0552, "cache_write": 0.345, "input": 0.276, "output": 1.101},
 "alibaba-cn/qwen3.8-flash": {"cache_read": 0.014844, "cache_write": 0.185547, "input": 0.11875, "output": 0.40073},
 "alibaba-cn/qwen3.8-max": {"cache_read": 0.22218, "cache_write": 2.22179, "input": 1.77744, "output": 5.33231},
 "alibaba-cn/qwen3.8-omni-flash": {"cache_read": 0.014, "cache_write": 0.0, "input": 0.113, "output": 0.382},
 "alibaba-cn/qwq-plus": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.23, "output": 0.574},
 "alibaba/qwen-flash": {"cache_read": 0.01, "cache_write": 0.0625, "input": 0.05, "output": 0.4},
 "alibaba/qwen-max": {"cache_read": 0.0, "cache_write": 0.0, "input": 1.6, "output": 6.4},
 "alibaba/qwen-mt-plus": {"cache_read": 0.0, "cache_write": 0.0, "input": 2.46, "output": 7.37},
 "alibaba/qwen-mt-turbo": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.16, "output": 0.49},
 "alibaba/qwen-omni-turbo": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.07, "output": 0.27},
 "alibaba/qwen-plus": {"cache_read": 0.08, "cache_write": 0.5, "input": 0.4, "output": 1.2},
 "alibaba/qwen-plus-character-ja": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.5, "output": 1.4},
 "alibaba/qwen-turbo": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.05, "output": 0.2},
 "alibaba/qwen-vl-max": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.8, "output": 3.2},
 "alibaba/qwen-vl-ocr": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.07, "output": 0.16},
 "alibaba/qwen-vl-plus": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.21, "output": 0.63},
 "alibaba/qwen2-5-omni-7b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.1, "output": 0.4},
 "alibaba/qwen3-14b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.35, "output": 1.4},
 "alibaba/qwen3-235b-a22b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.7, "output": 2.8},
 "alibaba/qwen3-32b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.7, "output": 2.8},
 "alibaba/qwen3-8b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.18, "output": 0.7},
 "alibaba/qwen3-coder-30b-a3b-instruct": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.45, "output": 2.25},
 "alibaba/qwen3-coder-480b-a35b-instruct": {"cache_read": 0.0, "cache_write": 0.0, "input": 1.5, "output": 7.5},
 "alibaba/qwen3-coder-flash": {"cache_read": 0.06, "cache_write": 0.375, "input": 0.3, "output": 1.5},
 "alibaba/qwen3-coder-plus": {"cache_read": 0.0, "cache_write": 0.0, "input": 1.0, "output": 5.0},
 "alibaba/qwen3-max": {"cache_read": 0.0, "cache_write": 0.0, "input": 1.2, "output": 6.0},
 "alibaba/qwen3-next-80b-a3b-instruct": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.5, "output": 2.0},
 "alibaba/qwen3-next-80b-a3b-thinking": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.5, "output": 6.0},
 "alibaba/qwen3-omni-flash": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.43, "output": 1.66},
 "alibaba/qwen3-vl-235b-a22b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.7, "output": 2.8},
 "alibaba/qwen3-vl-30b-a3b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.2, "output": 0.8},
 "alibaba/qwen3-vl-plus": {"cache_read": 0.04, "cache_write": 0.25, "input": 0.2, "output": 1.6},
 "alibaba/qwen3.5-122b-a10b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.4, "output": 3.2},
 "alibaba/qwen3.5-27b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.3, "output": 2.4},
 "alibaba/qwen3.5-35b-a3b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.25, "output": 2.0},
 "alibaba/qwen3.5-397b-a17b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.6, "output": 3.6},
 "alibaba/qwen3.5-flash": {"cache_read": 0.01, "cache_write": 0.125, "input": 0.1, "output": 0.4},
 "alibaba/qwen3.5-plus": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.4, "output": 2.4},
 "alibaba/qwen3.6-27b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.6, "output": 3.6},
 "alibaba/qwen3.6-35b-a3b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.375, "output": 2.25},
 "alibaba/qwen3.6-flash": {"cache_read": 0.025, "cache_write": 0.3125, "input": 0.25, "output": 1.5},
 "alibaba/qwen3.6-max-preview": {"cache_read": 0.13, "cache_write": 1.625, "input": 1.3, "output": 7.8},
 "alibaba/qwen3.6-plus": {"cache_read": 0.05, "cache_write": 0.625, "input": 0.5, "output": 3.0},
 "alibaba/qwen3.7-flash": {"cache_read": 0.006, "cache_write": 0.0375, "input": 0.03, "output": 0.13},
 "alibaba/qwen3.7-max": {"cache_read": 0.5, "cache_write": 3.125, "input": 2.5, "output": 7.5},
 "alibaba/qwen3.7-plus": {"cache_read": 0.08, "cache_write": 0.5, "input": 0.4, "output": 1.6},
 "alibaba/qwen3.8-flash": {"cache_read": 0.016, "cache_write": 0.2, "input": 0.15, "output": 0.47},
 "alibaba/qwen3.8-max": {"cache_read": 0.25, "cache_write": 2.5, "input": 2.0, "output": 6.0},
 "alibaba/qwen3.8-omni-flash": {"cache_read": 0.016, "cache_write": 0.0, "input": 0.15, "output": 0.47},
 "alibaba/qwq-plus": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.8, "output": 2.4},
 "anthropic/claude-fable-5": {"cache_read": 1.0, "cache_write": 12.5, "input": 10.0, "output": 50.0},
 "anthropic/claude-fable-5-1": {"cache_read": 0.25, "cache_write": 12.5, "input": 10.0, "output": 50.0},
 "anthropic/claude-haiku-4-5": {"cache_read": 0.1, "cache_write": 1.25, "input": 1.0, "output": 5.0},
 "anthropic/claude-haiku-4-5-20251001": {"cache_read": 0.1, "cache_write": 1.25, "input": 1.0, "output": 5.0},
 "anthropic/claude-haiku-5-5": {"cache_read": 0.01, "cache_write": 0.125, "input": 0.1, "output": 0.5},
 "anthropic/claude-opus-4-5": {"cache_read": 0.5, "cache_write": 6.25, "input": 5.0, "output": 25.0},
 "anthropic/claude-opus-4-5-20251101": {"cache_read": 0.5, "cache_write": 6.25, "input": 5.0, "output": 25.0},
 "anthropic/claude-opus-4-6": {"cache_read": 0.5, "cache_write": 6.25, "input": 5.0, "output": 25.0},
 "anthropic/claude-opus-4-7": {"cache_read": 0.5, "cache_write": 6.25, "input": 5.0, "output": 25.0},
 "anthropic/claude-opus-4-8": {"cache_read": 0.5, "cache_write": 6.25, "input": 5.0, "output": 25.0},
 "anthropic/claude-opus-5": {"cache_read": 0.5, "cache_write": 6.25, "input": 5.0, "output": 25.0},
 "anthropic/claude-opus-5-5": {"cache_read": 0.2, "cache_write": 5.0, "input": 4.0, "output": 20.0},
 "anthropic/claude-sonnet-4-5": {"cache_read": 0.3, "cache_write": 3.75, "input": 3.0, "output": 15.0},
 "anthropic/claude-sonnet-4-5-20250929": {"cache_read": 0.3, "cache_write": 3.75, "input": 3.0, "output": 15.0},
 "anthropic/claude-sonnet-4-6": {"cache_read": 0.3, "cache_write": 3.75, "input": 3.0, "output": 15.0},
 "anthropic/claude-sonnet-5": {"cache_read": 0.2, "cache_write": 2.5, "input": 2.0, "output": 10.0},
 "anthropic/claude-sonnet-5-5": {"cache_read": 0.1, "cache_write": 2.5, "input": 2.0, "output": 10.0},
 "cohere/c4ai-aya-expanse-32b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.5, "output": 1.5},
 "cohere/command-a-03-2025": {"cache_read": 0.0, "cache_write": 0.0, "input": 2.5, "output": 10.0},
 "cohere/command-a-plus-05-2026": {"cache_read": 0.0, "cache_write": 0.0, "input": 2.5, "output": 10.0},
 "cohere/command-a-reasoning-08-2025": {"cache_read": 0.0, "cache_write": 0.0, "input": 2.5, "output": 10.0},
 "cohere/command-a-translate-08-2025": {"cache_read": 0.0, "cache_write": 0.0, "input": 2.5, "output": 10.0},
 "cohere/command-a-vision-07-2025": {"cache_read": 0.0, "cache_write": 0.0, "input": 2.5, "output": 10.0},
 "cohere/command-r-08-2024": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.15, "output": 0.6},
 "cohere/command-r-plus-08-2024": {"cache_read": 0.0, "cache_write": 0.0, "input": 2.5, "output": 10.0},
 "cohere/command-r7b-12-2024": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0375, "output": 0.15},
 "cohere/command-r7b-arabic-02-2025": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0375, "output": 0.15},
 "cohere/north-mini-code-1-0": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0, "output": 0.0},
 "cohere/north-small-translate-09-2026": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0, "output": 0.0},
 "deepseek/deepseek-flash": {"cache_read": 0.003, "cache_write": 0.0, "input": 0.15, "output": 0.6},
 "deepseek/deepseek-v4-flash": {"cache_read": 0.003, "cache_write": 0.0, "input": 0.15, "output": 0.6},
 "deepseek/deepseek-v4-flash-vision-exp": {"cache_read": 0.003, "cache_write": 0.0, "input": 0.15, "output": 0.6},
 "deepseek/deepseek-v4-pro": {"cache_read": 0.022, "cache_write": 0.0, "input": 0.66, "output": 1.98},
 "google/deep-research-max-preview-04-2026": {"cache_read": 0.2, "cache_write": 0.0, "input": 2.0, "output": 12.0},
 "google/deep-research-preview-04-2026": {"cache_read": 0.2, "cache_write": 0.0, "input": 2.0, "output": 12.0},
 "google/gemini-2.5-computer-use-preview-10-2025": {"cache_read": 0.0, "cache_write": 0.0, "input": 1.25, "output": 10.0},
 "google/gemini-2.5-flash": {"cache_read": 0.03, "cache_write": 0.0, "input": 0.3, "output": 2.5},
 "google/gemini-2.5-flash-lite": {"cache_read": 0.01, "cache_write": 0.0, "input": 0.1, "output": 0.4},
 "google/gemini-2.5-pro": {"cache_read": 0.125, "cache_write": 0.0, "input": 1.25, "output": 10.0},
 "google/gemini-3-flash-preview": {"cache_read": 0.05, "cache_write": 0.0, "input": 0.5, "output": 3.0},
 "google/gemini-3.1-flash-lite": {"cache_read": 0.025, "cache_write": 0.0, "input": 0.25, "output": 1.5},
 "google/gemini-3.1-flash-lite-preview": {"cache_read": 0.025, "cache_write": 0.0, "input": 0.25, "output": 1.5},
 "google/gemini-3.1-flash-live-preview": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.75, "output": 4.5},
 "google/gemini-3.1-pro-preview": {"cache_read": 0.2, "cache_write": 0.0, "input": 2.0, "output": 12.0},
 "google/gemini-3.1-pro-preview-customtools": {"cache_read": 0.2, "cache_write": 0.0, "input": 2.0, "output": 12.0},
 "google/gemini-3.5-flash": {"cache_read": 0.15, "cache_write": 0.0, "input": 1.5, "output": 9.0},
 "google/gemini-3.5-flash-lite": {"cache_read": 0.03, "cache_write": 0.0, "input": 0.3, "output": 2.5},
 "google/gemini-3.6-flash": {"cache_read": 0.075, "cache_write": 0.0, "input": 0.75, "output": 3.75},
 "google/gemini-3.7-flash": {"cache_read": 0.075, "cache_write": 0.0, "input": 0.75, "output": 3.75},
 "google/gemini-3.8-flash": {"cache_read": 0.075, "cache_write": 0.0, "input": 0.75, "output": 3.75},
 "google/gemini-4-argon": {"cache_read": 0.1, "cache_write": 0.0, "input": 2.0, "output": 10.0},
 "google/gemini-flash-latest": {"cache_read": 0.075, "cache_write": 0.0, "input": 0.75, "output": 3.75},
 "google/gemini-flash-lite-latest": {"cache_read": 0.03, "cache_write": 0.0, "input": 0.3, "output": 2.5},
 "google/gemini-omni-flash-preview": {"cache_read": 0.0, "cache_write": 0.0, "input": 1.5, "output": 17.5},
 "google/gemini-pro-latest": {"cache_read": 0.2, "cache_write": 0.0, "input": 2.0, "output": 12.0},
 "google/lyria-3-clip-preview": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0, "output": 0.0},
 "google/lyria-3-pro-preview": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0, "output": 0.0},
 "meta/muse-spark-1.1": {"cache_read": 0.15, "cache_write": 0.0, "input": 1.25, "output": 4.25},
 "meta/muse-spark-1.2": {"cache_read": 0.15, "cache_write": 0.0, "input": 1.25, "output": 4.25},
 "meta/muse-spark-1.2-contributor": {"cache_read": 0.002, "cache_write": 0.0, "input": 0.1, "output": 0.2},
 "meta/muse-spark-1.3": {"cache_read": 0.15, "cache_write": 0.0, "input": 1.25, "output": 4.25},
 "meta/muse-spark-1.3-contributor": {"cache_read": 0.002, "cache_write": 0.0, "input": 0.1, "output": 0.2},
 "meta/muse-wonder-1.0": {"cache_read": 0.2, "cache_write": 0.0, "input": 4.0, "output": 20.0},
 "minimax-cn/minimax-m2": {"cache_read": 0.0314, "cache_write": 0.3922, "input": 0.3137, "output": 1.2549},
 "minimax-cn/minimax-m2.1": {"cache_read": 0.0314, "cache_write": 0.3922, "input": 0.3137, "output": 1.2549},
 "minimax-cn/minimax-m2.5": {"cache_read": 0.0314, "cache_write": 0.3922, "input": 0.3137, "output": 1.2549},
 "minimax-cn/minimax-m2.5-highspeed": {"cache_read": 0.0314, "cache_write": 0.3922, "input": 0.6275, "output": 2.5098},
 "minimax-cn/minimax-m2.7": {"cache_read": 0.0627, "cache_write": 0.3922, "input": 0.3137, "output": 1.2549},
 "minimax-cn/minimax-m2.7-highspeed": {"cache_read": 0.0627, "cache_write": 0.3922, "input": 0.6275, "output": 2.5098},
 "minimax-cn/minimax-m3": {"cache_read": 0.0627, "cache_write": 0.0, "input": 0.3137, "output": 1.2549},
 "minimax-cn/minimax-m3.1-flash": {"cache_read": 0.0149, "cache_write": 0.0, "input": 0.1494, "output": 0.5976},
 "minimax/minimax-m2": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.3, "output": 1.2},
 "minimax/minimax-m2.1": {"cache_read": 0.03, "cache_write": 0.375, "input": 0.3, "output": 1.2},
 "minimax/minimax-m2.5": {"cache_read": 0.03, "cache_write": 0.375, "input": 0.3, "output": 1.2},
 "minimax/minimax-m2.5-highspeed": {"cache_read": 0.03, "cache_write": 0.375, "input": 0.6, "output": 2.4},
 "minimax/minimax-m2.7": {"cache_read": 0.06, "cache_write": 0.375, "input": 0.3, "output": 1.2},
 "minimax/minimax-m2.7-highspeed": {"cache_read": 0.06, "cache_write": 0.375, "input": 0.6, "output": 2.4},
 "minimax/minimax-m3": {"cache_read": 0.06, "cache_write": 0.0, "input": 0.3, "output": 1.2},
 "minimax/minimax-m3.1-flash": {"cache_read": 0.015, "cache_write": 0.0, "input": 0.15, "output": 0.6},
 "mistral/codestral-2508": {"cache_read": 0.03, "cache_write": 0.0, "input": 0.3, "output": 0.9},
 "mistral/codestral-latest": {"cache_read": 0.03, "cache_write": 0.0, "input": 0.3, "output": 0.9},
 "mistral/deepseek-v4-1-flash-1017": {"cache_read": 0.007, "cache_write": 0.0, "input": 0.3, "output": 1.2},
 "mistral/devstral-2512": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.4, "output": 2.0},
 "mistral/devstral-latest": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.4, "output": 2.0},
 "mistral/devstral-medium-latest": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.4, "output": 2.0},
 "mistral/glm-5-2": {"cache_read": 0.14, "cache_write": 0.0, "input": 1.4, "output": 4.4},
 "mistral/labs-devstral-small-2512": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0, "output": 0.0},
 "mistral/labs-leanstral-1-5-1": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0, "output": 0.0},
 "mistral/magistral-medium-latest": {"cache_read": 0.0, "cache_write": 0.0, "input": 2.0, "output": 5.0},
 "mistral/ministral-14b-2512": {"cache_read": 0.02, "cache_write": 0.0, "input": 0.2, "output": 0.2},
 "mistral/ministral-3b-2512": {"cache_read": 0.01, "cache_write": 0.0, "input": 0.1, "output": 0.1},
 "mistral/ministral-3b-latest": {"cache_read": 0.01, "cache_write": 0.0, "input": 0.1, "output": 0.1},
 "mistral/ministral-8b-2512": {"cache_read": 0.015, "cache_write": 0.0, "input": 0.15, "output": 0.15},
 "mistral/ministral-8b-latest": {"cache_read": 0.015, "cache_write": 0.0, "input": 0.15, "output": 0.15},
 "mistral/mistral-large-2512": {"cache_read": 0.05, "cache_write": 0.0, "input": 0.5, "output": 1.5},
 "mistral/mistral-large-4": {"cache_read": 0.07, "cache_write": 0.0, "input": 0.7, "output": 2.1},
 "mistral/mistral-large-4-0-8": {"cache_read": 0.07, "cache_write": 0.0, "input": 0.7, "output": 2.1},
 "mistral/mistral-large-latest": {"cache_read": 0.05, "cache_write": 0.0, "input": 0.5, "output": 1.5},
 "mistral/mistral-medium-2505": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.4, "output": 2.0},
 "mistral/mistral-medium-2508": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.4, "output": 2.0},
 "mistral/mistral-medium-2604": {"cache_read": 0.15, "cache_write": 0.0, "input": 1.5, "output": 7.5},
 "mistral/mistral-medium-latest": {"cache_read": 0.15, "cache_write": 0.0, "input": 1.5, "output": 7.5},
 "mistral/mistral-small-2506": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.1, "output": 0.3},
 "mistral/mistral-small-2603": {"cache_read": 0.015, "cache_write": 0.0, "input": 0.15, "output": 0.6},
 "mistral/mistral-small-latest": {"cache_read": 0.015, "cache_write": 0.0, "input": 0.15, "output": 0.6},
 "mistral/open-mistral-nemo": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.15, "output": 0.15},
 "mistral/pixtral-12b": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.15, "output": 0.15},
 "mistral/voxtral-small-2507": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.1, "output": 0.4},
 "mistral/voxtral-small-latest": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.1, "output": 0.4},
 "mistral/zai-glm-5-2": {"cache_read": 0.14, "cache_write": 0.0, "input": 1.4, "output": 4.4},
 "mistral/zai-glm-5-3": {"cache_read": 0.14, "cache_write": 0.0, "input": 1.4, "output": 4.4},
 "mistral/zai-glm-5-3-flash": {"cache_read": 0.03, "cache_write": 0.0, "input": 0.15, "output": 0.5},
 "moonshotai-cn/kimi-k2.6": {"cache_read": 0.1643, "cache_write": 0.0, "input": 0.9711, "output": 4.0337},
 "moonshotai-cn/kimi-k2.7-code": {"cache_read": 0.1942, "cache_write": 0.0, "input": 0.9711, "output": 4.0337},
 "moonshotai-cn/kimi-k2.7-code-highspeed": {"cache_read": 0.3884, "cache_write": 0.0, "input": 1.9421, "output": 8.0673},
 "moonshotai-cn/kimi-k3": {"cache_read": 0.2988, "cache_write": 2.9879, "input": 2.9879, "output": 14.9395},
 "moonshotai-cn/kimi-k3.1-pro": {"cache_read": 0.1944, "cache_write": 1.9437, "input": 1.9437, "output": 10.1671},
 "moonshotai-cn/kimi-k3.1-pro-highspeed": {"cache_read": 0.1944, "cache_write": 3.8874, "input": 3.8874, "output": 20.3342},
 "moonshotai/kimi-k2.6": {"cache_read": 0.16, "cache_write": 0.0, "input": 0.95, "output": 4.0},
 "moonshotai/kimi-k2.7-code": {"cache_read": 0.19, "cache_write": 0.0, "input": 0.95, "output": 4.0},
 "moonshotai/kimi-k2.7-code-highspeed": {"cache_read": 0.38, "cache_write": 0.0, "input": 1.9, "output": 8.0},
 "moonshotai/kimi-k3": {"cache_read": 0.3, "cache_write": 3.0, "input": 3.0, "output": 15.0},
 "moonshotai/kimi-k3.1-pro": {"cache_read": 0.2, "cache_write": 2.0, "input": 2.0, "output": 10.0},
 "moonshotai/kimi-k3.1-pro-highspeed": {"cache_read": 0.2, "cache_write": 4.0, "input": 4.0, "output": 20.0},
 "openai/gpt-3.5-turbo": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.5, "output": 1.5},
 "openai/gpt-4": {"cache_read": 0.0, "cache_write": 0.0, "input": 30.0, "output": 60.0},
 "openai/gpt-4-turbo": {"cache_read": 0.0, "cache_write": 0.0, "input": 10.0, "output": 30.0},
 "openai/gpt-4.1": {"cache_read": 0.5, "cache_write": 0.0, "input": 2.0, "output": 8.0},
 "openai/gpt-4.1-mini": {"cache_read": 0.1, "cache_write": 0.0, "input": 0.4, "output": 1.6},
 "openai/gpt-4.1-nano": {"cache_read": 0.025, "cache_write": 0.0, "input": 0.1, "output": 0.4},
 "openai/gpt-4o": {"cache_read": 1.25, "cache_write": 0.0, "input": 2.5, "output": 10.0},
 "openai/gpt-4o-2024-05-13": {"cache_read": 0.0, "cache_write": 0.0, "input": 5.0, "output": 15.0},
 "openai/gpt-4o-2024-08-06": {"cache_read": 1.25, "cache_write": 0.0, "input": 2.5, "output": 10.0},
 "openai/gpt-4o-2024-11-20": {"cache_read": 1.25, "cache_write": 0.0, "input": 2.5, "output": 10.0},
 "openai/gpt-4o-mini": {"cache_read": 0.075, "cache_write": 0.0, "input": 0.15, "output": 0.6},
 "openai/gpt-5": {"cache_read": 0.125, "cache_write": 0.0, "input": 1.25, "output": 10.0},
 "openai/gpt-5-mini": {"cache_read": 0.025, "cache_write": 0.0, "input": 0.25, "output": 2.0},
 "openai/gpt-5-nano": {"cache_read": 0.005, "cache_write": 0.0, "input": 0.05, "output": 0.4},
 "openai/gpt-5-pro": {"cache_read": 0.0, "cache_write": 0.0, "input": 15.0, "output": 120.0},
 "openai/gpt-5.1": {"cache_read": 0.125, "cache_write": 0.0, "input": 1.25, "output": 10.0},
 "openai/gpt-5.2": {"cache_read": 0.175, "cache_write": 0.0, "input": 1.75, "output": 14.0},
 "openai/gpt-5.2-pro": {"cache_read": 0.0, "cache_write": 0.0, "input": 21.0, "output": 168.0},
 "openai/gpt-5.3-codex": {"cache_read": 0.175, "cache_write": 0.0, "input": 1.75, "output": 14.0},
 "openai/gpt-5.3-codex-spark": {"cache_read": 0.175, "cache_write": 0.0, "input": 1.75, "output": 14.0},
 "openai/gpt-5.4": {"cache_read": 0.25, "cache_write": 0.0, "input": 2.5, "output": 15.0},
 "openai/gpt-5.4-mini": {"cache_read": 0.075, "cache_write": 0.0, "input": 0.75, "output": 4.5},
 "openai/gpt-5.4-nano": {"cache_read": 0.02, "cache_write": 0.0, "input": 0.2, "output": 1.25},
 "openai/gpt-5.4-pro": {"cache_read": 0.0, "cache_write": 0.0, "input": 30.0, "output": 180.0},
 "openai/gpt-5.5": {"cache_read": 0.5, "cache_write": 0.0, "input": 5.0, "output": 30.0},
 "openai/gpt-5.5-pro": {"cache_read": 0.0, "cache_write": 0.0, "input": 30.0, "output": 180.0},
 "openai/gpt-5.6": {"cache_read": 0.4, "cache_write": 5.0, "input": 4.0, "output": 20.0},
 "openai/gpt-5.6-luna": {"cache_read": 0.02, "cache_write": 0.25, "input": 0.2, "output": 1.2},
 "openai/gpt-5.6-sol": {"cache_read": 0.4, "cache_write": 5.0, "input": 4.0, "output": 20.0},
 "openai/gpt-5.6-terra": {"cache_read": 0.2, "cache_write": 2.5, "input": 2.0, "output": 12.0},
 "openai/gpt-6-astra": {"cache_read": 1.0, "cache_write": 12.5, "input": 10.0, "output": 50.0},
 "openai/gpt-6-luna": {"cache_read": 0.01, "cache_write": 0.125, "input": 0.1, "output": 0.5},
 "openai/gpt-6-sol": {"cache_read": 0.2, "cache_write": 2.5, "input": 2.0, "output": 10.0},
 "openai/gpt-6.1-sol": {"cache_read": 0.1, "cache_write": 2.5, "input": 2.0, "output": 10.0},
 "openai/gpt-6.1-terra": {"cache_read": 0.05, "cache_write": 1.25, "input": 1.0, "output": 5.0},
 "openai/gpt-daybreak-blue-latest": {"cache_read": 0.4, "cache_write": 5.0, "input": 4.0, "output": 20.0},
 "openai/gpt-daybreak-red-latest": {"cache_read": 1.25, "cache_write": 15.625, "input": 12.5, "output": 75.0},
 "openai/o1": {"cache_read": 7.5, "cache_write": 0.0, "input": 15.0, "output": 60.0},
 "openai/o1-pro": {"cache_read": 0.0, "cache_write": 0.0, "input": 150.0, "output": 600.0},
 "openai/o3": {"cache_read": 0.5, "cache_write": 0.0, "input": 2.0, "output": 8.0},
 "openai/o3-mini": {"cache_read": 0.55, "cache_write": 0.0, "input": 1.1, "output": 4.4},
 "openai/o3-pro": {"cache_read": 0.0, "cache_write": 0.0, "input": 20.0, "output": 80.0},
 "openai/o4-mini": {"cache_read": 0.275, "cache_write": 0.0, "input": 1.1, "output": 4.4},
 "r4/deepseek-v4.1-flash": {"cache_read": 0.003, "cache_write": 0.0, "input": 0.15, "output": 0.6},
 "r4/deepseek-v4.1-flash-fast": {"cache_read": 0.06, "cache_write": 0.0, "input": 1.2, "output": 6.0},
 "r4/deepseek-v4.1-flash-ultrafast": {"cache_read": 0.072, "cache_write": 0.0, "input": 3.6, "output": 14.4},
 "stepfun/step-3.5-flash": {"cache_read": 0.02092, "cache_write": 0.0, "input": 0.10461, "output": 0.31384},
 "stepfun/step-3.5-flash-2603": {"cache_read": 0.02092, "cache_write": 0.0, "input": 0.10461, "output": 0.31384},
 "stepfun/step-3.7-flash": {"cache_read": 0.04035, "cache_write": 0.0, "input": 0.20175, "output": 1.21052},
 "stepfun/step-5-preview": {"cache_read": 0.10461, "cache_write": 0.0, "input": 1.04613, "output": 2.98895},
 "volcengine/doubao-seed-1-6-251015": {"cache_read": 0.02375, "cache_write": 0.0, "input": 0.11875, "output": 1.18747},
 "volcengine/doubao-seed-1-6-flash-250828": {"cache_read": 0.00445, "cache_write": 0.0, "input": 0.02227, "output": 0.22265},
 "volcengine/doubao-seed-1-6-vision-250815": {"cache_read": 0.02375, "cache_write": 0.0, "input": 0.11875, "output": 1.18747},
 "volcengine/doubao-seed-1-8-251228": {"cache_read": 0.02375, "cache_write": 0.0, "input": 0.11875, "output": 1.18747},
 "volcengine/doubao-seed-2-0-code-preview-260215": {"cache_read": 0.095, "cache_write": 0.0, "input": 0.47499, "output": 2.37494},
 "volcengine/doubao-seed-2-0-lite-260428": {"cache_read": 0.01781, "cache_write": 0.0, "input": 0.08906, "output": 0.53436},
 "volcengine/doubao-seed-2-0-mini-260428": {"cache_read": 0.00594, "cache_write": 0.0, "input": 0.02969, "output": 0.29687},
 "volcengine/doubao-seed-2-0-pro-260215": {"cache_read": 0.095, "cache_write": 0.0, "input": 0.47499, "output": 2.37494},
 "volcengine/doubao-seed-2-1-pro-260628": {"cache_read": 0.17812, "cache_write": 0.0, "input": 0.8906, "output": 4.45301},
 "volcengine/doubao-seed-2-1-turbo-260628": {"cache_read": 0.08906, "cache_write": 0.0, "input": 0.4453, "output": 2.22651},
 "volcengine/doubao-seed-character-260628": {"cache_read": 0.02375, "cache_write": 0.0, "input": 0.11875, "output": 0.29687},
 "volcengine/doubao-seed-evolving": {"cache_read": 0.17812, "cache_write": 0.0, "input": 0.8906, "output": 4.45301},
 "xai/grok-4.20-0309-non-reasoning": {"cache_read": 0.2, "cache_write": 0.0, "input": 1.25, "output": 2.5},
 "xai/grok-4.20-0309-reasoning": {"cache_read": 0.2, "cache_write": 0.0, "input": 1.25, "output": 2.5},
 "xai/grok-4.20-multi-agent-0309": {"cache_read": 0.2, "cache_write": 0.0, "input": 1.25, "output": 2.5},
 "xai/grok-4.3": {"cache_read": 0.2, "cache_write": 0.0, "input": 1.25, "output": 2.5},
 "xai/grok-4.5": {"cache_read": 0.3, "cache_write": 0.0, "input": 2.0, "output": 6.0},
 "xai/grok-4.6": {"cache_read": 0.5, "cache_write": 0.0, "input": 2.0, "output": 6.0},
 "xai/grok-4.7": {"cache_read": 0.5, "cache_write": 0.0, "input": 2.0, "output": 6.0},
 "xai/grok-build-0.1": {"cache_read": 0.2, "cache_write": 0.0, "input": 1.0, "output": 2.0},
 "xiaomi/mimo-v2.5": {"cache_read": 0.0028, "cache_write": 0.0, "input": 0.14, "output": 0.28},
 "xiaomi/mimo-v2.5-pro": {"cache_read": 0.0036, "cache_write": 0.0, "input": 0.435, "output": 0.87},
 "xiaomi/mimo-v2.5-pro-ultraspeed": {"cache_read": 0.0108, "cache_write": 0.0, "input": 1.305, "output": 2.61},
 "xiaomi/mimo-v2.6-flash": {"cache_read": 0.0028, "cache_write": 0.0, "input": 0.14, "output": 0.28},
 "xiaomi/mimo-v2.6-pro": {"cache_read": 0.0036, "cache_write": 0.0, "input": 0.435, "output": 0.87},
 "xiaomi/mimo-v2.6-pro-ultraspeed": {"cache_read": 0.036, "cache_write": 0.0, "input": 4.35, "output": 8.7},
 "zai/glm-4.5": {"cache_read": 0.11, "cache_write": 0.0, "input": 0.6, "output": 2.2},
 "zai/glm-4.5-air": {"cache_read": 0.03, "cache_write": 0.0, "input": 0.2, "output": 1.1},
 "zai/glm-4.5-flash": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0, "output": 0.0},
 "zai/glm-4.5v": {"cache_read": 0.11, "cache_write": 0.0, "input": 0.6, "output": 1.8},
 "zai/glm-4.6": {"cache_read": 0.11, "cache_write": 0.0, "input": 0.6, "output": 2.2},
 "zai/glm-4.6v": {"cache_read": 0.05, "cache_write": 0.0, "input": 0.3, "output": 0.9},
 "zai/glm-4.6v-flash": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0, "output": 0.0},
 "zai/glm-4.7": {"cache_read": 0.11, "cache_write": 0.0, "input": 0.6, "output": 2.2},
 "zai/glm-4.7-flash": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0, "output": 0.0},
 "zai/glm-4.7-flashx": {"cache_read": 0.01, "cache_write": 0.0, "input": 0.07, "output": 0.4},
 "zai/glm-5": {"cache_read": 0.2, "cache_write": 0.0, "input": 1.0, "output": 3.2},
 "zai/glm-5-turbo": {"cache_read": 0.24, "cache_write": 0.0, "input": 1.2, "output": 4.0},
 "zai/glm-5.1": {"cache_read": 0.26, "cache_write": 0.0, "input": 1.4, "output": 4.4},
 "zai/glm-5.2": {"cache_read": 0.26, "cache_write": 0.0, "input": 1.4, "output": 4.4},
 "zai/glm-5.2-highspeed": {"cache_read": 0.26, "cache_write": 0.0, "input": 1.4, "output": 4.4},
 "zai/glm-5.3": {"cache_read": 0.26, "cache_write": 0.0, "input": 1.4, "output": 4.4},
 "zai/glm-5.3-flash": {"cache_read": 0.03, "cache_write": 0.0, "input": 0.15, "output": 0.5},
 "zai/glm-5.3-flashx": {"cache_read": 0.075, "cache_write": 0.0, "input": 0.37, "output": 1.25},
 "zai/glm-5.3-highspeed": {"cache_read": 0.26, "cache_write": 0.0, "input": 1.4, "output": 4.4},
 "zai/glm-5v-turbo": {"cache_read": 0.24, "cache_write": 0.0, "input": 1.2, "output": 4.0},
 "zhipuai/glm-4.5": {"cache_read": 0.11, "cache_write": 0.0, "input": 0.6, "output": 2.2},
 "zhipuai/glm-4.5-air": {"cache_read": 0.0239, "cache_write": 0.0, "input": 0.11952, "output": 0.89637},
 "zhipuai/glm-4.5-flash": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0, "output": 0.0},
 "zhipuai/glm-4.5v": {"cache_read": 0.05976, "cache_write": 0.0, "input": 0.29879, "output": 0.89637},
 "zhipuai/glm-4.6": {"cache_read": 0.11, "cache_write": 0.0, "input": 0.6, "output": 2.2},
 "zhipuai/glm-4.6v": {"cache_read": 0.02988, "cache_write": 0.0, "input": 0.1494, "output": 0.44819},
 "zhipuai/glm-4.6v-flash": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0, "output": 0.0},
 "zhipuai/glm-4.7": {"cache_read": 0.08964, "cache_write": 0.0, "input": 0.44819, "output": 2.09153},
 "zhipuai/glm-4.7-flash": {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0, "output": 0.0},
 "zhipuai/glm-4.7-flashx": {"cache_read": 0.01494, "cache_write": 0.0, "input": 0.0747, "output": 0.44819},
 "zhipuai/glm-5": {"cache_read": 0.1494, "cache_write": 0.0, "input": 0.59758, "output": 2.68911},
 "zhipuai/glm-5.1": {"cache_read": 0.19421, "cache_write": 0.0, "input": 0.89637, "output": 3.58548},
 "zhipuai/glm-5.2": {"cache_read": 0.29879, "cache_write": 0.0, "input": 1.19516, "output": 4.18306},
 "zhipuai/glm-5.2-highspeed": {"cache_read": 0.29879, "cache_write": 0.0, "input": 1.19516, "output": 4.18306},
 "zhipuai/glm-5.3": {"cache_read": 0.29879, "cache_write": 0.0, "input": 1.19516, "output": 4.18306},
 "zhipuai/glm-5.3-flash": {"cache_read": 0.03436, "cache_write": 0.0, "input": 0.11952, "output": 0.41831},
 "zhipuai/glm-5.3-flashx": {"cache_read": 0.08516, "cache_write": 0.0, "input": 0.29879, "output": 1.04577},
 "zhipuai/glm-5.3-highspeed": {"cache_read": 0.29879, "cache_write": 0.0, "input": 1.19516, "output": 4.18306},
 "zhipuai/glm-5v-turbo": {"cache_read": 0.17927, "cache_write": 0.0, "input": 0.74698, "output": 3.28669},
}
PRICING_META = {"count": 329, "note": "models.dev 官方渠道增量同步；人工纠错走脚本 OVERRIDES；*-highspeed 按同厂基础模型派生牌价；R4 Coder 中转价按 GET /v1/models 补充（2026-11-17）", "source": "https://models.dev/api.json", "synced_at": "2026-11-02"}
# END PRICING DATA
# ---------------------------------------------------------------------------


# ---- 匹配：模型名(裸名，大小写不敏感) → 四价 ----
_IDX_LOCK = threading.Lock()
_IDX = None      # {"qual": 全限定键→价, "bare": 裸名→[(provider, 价)]}，随表代际重建
_IDX_GEN = -1
_GEN = 0         # 合并表代际（覆盖层变化时递增）

_PROVIDER_HINTS = (
    # 按 provider_id 子串给出同厂 provider 优先序（account:bigmodel-* → 智谱国内牌价）
    ("bigmodel", ("zhipuai", "zai")),
    ("zhipu", ("zhipuai", "zai")),
    ("zai", ("zai", "zhipuai")),
    ("moonshot", ("moonshotai",)),
    ("kimi", ("moonshotai",)),
    ("minimax", ("minimax",)),
    ("deepseek", ("deepseek",)),
    ("anthropic", ("anthropic",)),
    ("openai", ("openai",)),
    ("google", ("google",)),
    ("gemini", ("google",)),
    ("alibaba", ("alibaba", "alibaba-cn")),
    ("qwen", ("alibaba", "alibaba-cn")),
    ("xiaomi", ("xiaomi",)),
    ("stepfun", ("stepfun",)),
    ("grok", ("xai",)),
    ("xai", ("xai",)),
)


def _hint_providers(provider_id):
    pid = (provider_id or "").lower()
    for token, provs in _PROVIDER_HINTS:
        if token in pid:
            return provs
    return ()


def _build_index(table):
    qual, bare = {}, {}
    for key, rates in table.items():
        p, _, m = key.lower().partition("/")
        if not m:
            p, m = "", key
        qual[p + "/" + m] = rates
        bare.setdefault(m, []).append((p, rates))
    for lst in bare.values():
        lst.sort(key=lambda e: e[0])   # 同名多厂按 provider 字典序，保底确定性
    return {"qual": qual, "bare": bare}


def _index():
    global _IDX, _IDX_GEN, _GEN
    with _IDX_LOCK:
        if _IDX is None or _IDX_GEN != _GEN:
            _IDX = _build_index(current_table())
            _IDX_GEN = _GEN
        return _IDX


def _pick(lst, provider_id):
    if len(lst) == 1:
        return lst[0][1]
    for prov in _hint_providers(provider_id):
        for p, rates in lst:
            if p == prov:
                return rates
    return lst[0][1]


def lookup_full(model_id, provider_id=""):
    """模型名 → (四价, 命中键, 命中层级)。层级 exact→fuzzy→default，
    永不返回 None（未命中按 DEFAULT_RATES 兜底均价）。全部精确/子串，无正则。
    覆盖层的全限定键经 _build_index 同样拆出裸名，无需独立后缀层。"""
    idx = _index()
    name = (model_id or "").strip().lower()
    if not name:
        return dict(DEFAULT_RATES), "", "default"
    if "/" in name:   # 模型名自带 provider 前缀：先按全限定精确匹配
        rates = idx["qual"].get(name)
        if rates is not None:
            return rates, name, "exact"
        name = name.split("/", 1)[1]
    lst = idx["bare"].get(name)
    if lst:
        return dict(_pick(lst, provider_id)), name, "exact"
    fuzzy = sorted((m for m in idx["bare"] if len(m) >= 5 and (m in name or name in m)),
                   key=lambda m: (-len(m), m))
    if fuzzy:
        return dict(_pick(idx["bare"][fuzzy[0]], provider_id)), fuzzy[0], "fuzzy"
    return dict(DEFAULT_RATES), "", "default"


def lookup(model_id, provider_id=""):
    return lookup_full(model_id, provider_id)[0]


def compute_group_cost(model_id, provider_id, inp, out, cr, cw):
    """按本库口径计一组（同模型同 provider 聚合后）token 的美元费用。
    input 已含 cache_read/cache_creation，须先拆出裸输入；负数脏数据钳为 0。"""
    rates = lookup(model_id, provider_id)
    inp = max(0.0, float(inp or 0))
    out = max(0.0, float(out or 0))
    cr = max(0.0, float(cr or 0))
    cw = max(0.0, float(cw or 0))
    bare = max(0.0, inp - cr - cw)
    cost = (bare * rates["input"] + cr * rates["cache_read"]
            + cw * rates["cache_write"] + out * rates["output"]) / 1e6
    return round(cost, 8)


def merge_model_costs(groups):
    """groups: (model_id, provider_id, input, output, cache_read, cache_creation) 迭代。
    返回 (total_cost_usd, {首见原名 model_id: cost})；total 与分组各自 8 位小数。"""
    total = 0.0
    per = {}
    for model_id, provider_id, inp, out, cr, cw in groups:
        c = compute_group_cost(model_id, provider_id, inp, out, cr, cw)
        total += c
        if model_id:
            per[model_id] = round(per.get(model_id, 0.0) + c, 8)
    return round(total, 8), per


# ---- 运行时覆盖层与汇率（pricing-cache.json）----
_STATE_LOCK = threading.Lock()
_START_LOCK = threading.Lock()
_STARTED = False     # 刷新线程已启动（幂等；与 _WAKE 分开——_WAKE 置位会让 wait 立即返回）
_OVERLAY = None      # 覆盖表（cache 文件 pricing 段）
_MERGED = None       # builtin+overlay 合并表（代际缓存）
_FX = None           # {"rate","at","source"}
_CACHE_PATH = None   # Path
_CACHE_ST = None     # 已加载的 (st_mtime_ns, st_size)
_CFG = {"url": PRICING_URL, "fx_url": FX_URL, "fetch": True}
_WAKE = threading.Event()


def configure(cfg=None, config_dir=None):
    """注入 pricing 配置与缓存目录。缓存文件落 config.json 同目录（运行目录即
    config 所在目录）；config_dir 为 None 时按脚本目录 → 标准数据目录双基地查找。"""
    global _CACHE_PATH
    p = (cfg or {}).get("pricing")
    if not isinstance(p, dict):
        p = {}
    fx = p.get("fx") if isinstance(p.get("fx"), dict) else {}
    base = Path(config_dir) if config_dir else Path(__file__).parent
    if config_dir is None:
        alt = Path.home() / ".zcode" / "zcode-token-usage-statusbar"
        if not (base / "config.json").exists() and (alt / "config.json").exists():
            base = alt
    with _STATE_LOCK:
        _CFG["url"] = p.get("url") or PRICING_URL
        _CFG["fx_url"] = fx.get("url") or FX_URL
        _CFG["fetch"] = p.get("fetch") is not False
        _CACHE_PATH = base / "pricing-cache.json"


def _valid_rates_map(mapping):
    if not isinstance(mapping, dict):
        return False
    for v in mapping.values():
        if not isinstance(v, dict) or not isinstance(v.get("input"), (int, float)) \
                or not isinstance(v.get("output"), (int, float)):
            return False
        for k in ("input", "output", "cache_read", "cache_write"):
            x = v.get(k)
            if x is not None and (not isinstance(x, (int, float)) or not math.isfinite(x) or x < 0):
                return False
    return True


def _valid_fx(fx):
    if not isinstance(fx, dict):
        return False
    r = fx.get("rate")
    return isinstance(r, (int, float)) and math.isfinite(r) and 0 < r < 1e6


def _bump_gen():
    global _MERGED, _GEN
    _MERGED = None
    _GEN += 1


def _lazy_reload():
    """快照路径的低开销入口：stat 缓存文件，变了才重读（含外部手工放置的缓存）。"""
    global _CACHE_ST, _OVERLAY, _FX
    if _CACHE_PATH is None:
        return
    try:
        st = os.stat(_CACHE_PATH)
        sig = (st.st_mtime_ns, st.st_size)
    except OSError:
        return
    if sig == _CACHE_ST:
        return
    data = {}
    try:
        data = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("version") != CACHE_VERSION:
            data = {}
    except (OSError, ValueError):
        data = {}
    overlay = data.get("pricing")
    fx = data.get("fx")
    with _STATE_LOCK:
        if _valid_rates_map(overlay):
            _OVERLAY = overlay
        else:
            _OVERLAY = None
        _FX = fx if _valid_fx(fx) else None
        _CACHE_ST = sig   # 损坏文件同样记位，避免每个快照反复解析
        _bump_gen()


def current_table():
    global _MERGED
    _lazy_reload()
    with _STATE_LOCK:
        if _MERGED is None:
            m = dict(PRICING)
            if _OVERLAY:
                m.update(_OVERLAY)
            _MERGED = m   # 覆盖层变化经 _bump_gen 置空后由本处重建
        return _MERGED


def fx_view():
    """当前汇率视图（供快照顶层 fx 字段）：{"rate","at","source"} 或 None。"""
    _lazy_reload()
    with _STATE_LOCK:
        return dict(_FX) if _FX else None


def _read_cache_raw():
    if _CACHE_PATH is None:
        return {}
    try:
        d = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_cache(payload):
    """校验 → 同目录临时文件 → os.replace 原子替换 → 重载内存。"""
    if _CACHE_PATH is None:
        return
    if payload.get("pricing") is not None and not _valid_rates_map(payload["pricing"]):
        return
    if payload.get("fx") is not None and not _valid_fx(payload["fx"]):
        payload = dict(payload)
        payload["fx"] = None
        payload["fx_at"] = None
    tmp = _CACHE_PATH.with_name(_CACHE_PATH.name + ".tmp")
    try:
        tmp.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        os.replace(tmp, _CACHE_PATH)
    except OSError:
        try:
            tmp.unlink()
        except OSError:
            pass
        return
    global _CACHE_ST
    with _STATE_LOCK:
        _CACHE_ST = None
    _lazy_reload()


def _fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "zcode-token-usage-statusbar-pricing/1"})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as resp:
        if resp.status != 200:
            raise OSError("http %s" % resp.status)
        return json.loads(resp.read().decode("utf-8", "replace"))


def _fetch_fx(url):
    """汇率源返回 {rates:{CNY:number}}（open.er-api / frankfurter 同形）。
    拉不到或形状不对返回 None——展示层诚实降级 USD，不编造汇率。"""
    try:
        d = _fetch_json(url)
        rate = (d.get("rates") or {}).get("CNY") if isinstance(d, dict) else None
        if isinstance(rate, (int, float)) and math.isfinite(rate) and 0 < rate < 1e6:
            return round(float(rate), 6)
    except Exception:
        pass
    return None


def _host(url):
    m = re.match(r"https?://([^/]+)", url or "")
    return m.group(1) if m else url or ""


def _refresh_once():
    """按 12h TTL 各自查新：价表(models.dev)与汇率(er-api)。任一成功即合并落盘；
    失败的部分保留磁盘旧值。"""
    now_ms = int(time.time() * 1000)
    cache = _read_cache_raw()
    overlay = None
    fx = None
    if now_ms - (cache.get("pricing_at") or 0) >= PRICING_TTL_MS:
        try:
            data = _fetch_json(_CFG["url"])
            overlay = convert_models_dev(data) or None   # 空结果视同失败，保留旧值
        except Exception:
            overlay = None
    if now_ms - (cache.get("fx_at") or 0) >= PRICING_TTL_MS:
        fx_urls = [_CFG["fx_url"]]
        if _CFG["fx_url"] == FX_URL:   # 仅默认主源时走公益兜底链（自定义配置不擅自换源）
            if FX_FALLBACK_URL not in fx_urls:
                fx_urls.append(FX_FALLBACK_URL)
        for fx_url in fx_urls:
            rate = _fetch_fx(fx_url)
            if rate:
                fx = {"rate": rate, "at": now_ms, "source": _host(fx_url)}
                break
    if overlay is None and fx is None:
        return
    _write_cache({
        "version": CACHE_VERSION,
        "pricing": overlay if overlay is not None else cache.get("pricing"),
        "pricing_at": now_ms if overlay is not None else cache.get("pricing_at"),
        "fx": fx if fx is not None else cache.get("fx"),
        "fx_at": now_ms if fx is not None else cache.get("fx_at"),
    })


def _refresh_loop():
    """daemon 线程：启动即按 TTL 查新一次，此后每 12h 一 tick（价表+汇率同 tick）。
    随 serve 进程退出终止，无独立清理面。"""
    while True:
        try:
            _refresh_once()
        except Exception:
            pass
        _WAKE.wait(SYNC_INTERVAL_S)


def start_refresh(cfg=None, config_dir=None):
    """serve 常驻进程启动时调用一次；一次性 CLI 不调用（只读不拉网）。
    cfg 传 None 且已 configure 过时不覆盖既有配置。返回线程对象或 None（fetch 关闭/已启动）。"""
    global _STARTED
    if cfg is not None or _CACHE_PATH is None:
        configure(cfg, config_dir)
    if not _CFG["fetch"]:
        return None
    with _START_LOCK:
        if _STARTED:
            return None
        _STARTED = True
    t = threading.Thread(target=_refresh_loop, name="token-pricing-sync", daemon=True)
    t.start()
    return t
