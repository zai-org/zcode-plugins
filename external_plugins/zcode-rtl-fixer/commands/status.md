---
description: Show installation and settings status of the ZCode RTL Fixer
---

# /rtl:status — وضعیت RTL Fixer

اجرای:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/patch-zcode.mjs" --status
```

خروجی JSON را برای کاربر جمع‌بندی کن (فارسی):

- `extracted` / `patched` / `backup` / `launcher` / `desktopEntry` — کدام بخش‌ها آماده‌اند
- تنظیمات فعلی: فونت، مقیاس فونت، وضعیت جداول

و بسته به وضعیت، دستور بعدی را پیشنهاد بده:
- `patched:false` → `/rtl:install`
- کاربر می‌خواهد فونت عوض کند → `/rtl:font`
- مشکل بصری → اسکیل `rtl-fixer` را بخوان و تست بصری (اسکرین‌شات) انجام بده.
