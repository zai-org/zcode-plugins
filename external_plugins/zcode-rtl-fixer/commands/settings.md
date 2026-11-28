---
description: Change ZCode RTL Fixer settings (JSON patch) and re-apply them
allowed-tools: Bash(node:*)
---

# /rtl:settings — تغییر تنظیمات

Args: $ARGUMENTS — JSON patch. کلیدهای معتبر:

| کلید | مقادیر | پیش‌فرض |
|---|---|---|
| `enabled` | `true`/`false` | `true` |
| `fontEnabled` | فونت فارسی روی متن‌های فارسی | `true` |
| `fontFamily` | رشتهٔ CSS font-family | `"Vazirmatn, …"` |
| `fontSizeScale` | عدد (۱ = بدون تغییر) | `1.05` |
| `fixTables` | جداول فارسی راست‌چین شوند | `true` |
| `fixLists` | بولت/شمارهٔ آیتم‌های لیست فارسی به راست برود | `true` |
| `mainLauncher` | لانچر اصلی «ZCode» هم به نسخهٔ پچ‌شده pointer شود | `false` |
| `probe` | فقط برای تست تزریق (عنوان پنجره `RTLPROBE-…` می‌شود) | `false` |

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/settings.mjs" set "$ARGUMENTS"
node "${CLAUDE_PLUGIN_ROOT}/scripts/patch-zcode.mjs"    # bake تنظیمات جدید — اجباری
```

JSON نامعتبر بود، معادل درست را پیشنهاد بده و دوباره اجرا کن. در پایان یادآوری کن زکد باید از لانچر «ZCode RTL» دوباره باز شود.
