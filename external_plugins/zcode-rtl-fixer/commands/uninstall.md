---
description: Uninstall the ZCode RTL Fixer patch and restore the original ZCode Desktop
allowed-tools: Bash(node:*)
---

# /rtl:uninstall — حذف پچ RTL Fixer

Args: $ARGUMENTS — اگر «کامل» یا «purge» بود، نسخهٔ استخراج‌شده هم حذف شود.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/patch-zcode.mjs" --uninstall
node "${CLAUDE_PLUGIN_ROOT}/scripts/patch-zcode.mjs" --purge   # فقط اگر کاربر purge خواسته
```

بعد از اجرا گزارش بده:

- `app.asar` اصلی بازگردانده شد؛ زکد را از آیکون/لانچر همیشگی‌اش اجرا کند (لانچر «ZCode RTL» حذف شده است).
- تنظیمات `~/.zcode/rtl-fixer/settings.json` حفظ می‌شود (برای نصب دوباره)؛ اگر کاربر حذف کامل خواست، آن فایل را هم پاک کن.
