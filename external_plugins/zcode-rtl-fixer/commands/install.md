---
description: Install or re-apply the ZCode RTL Fixer patch (mixed Persian/English text fix for the chat box)
allowed-tools: Bash(node:*)
---

# /rtl:install — نصب/اعمال پچ RTL Fixer

Args: $ARGUMENTS (اختیاری: مسیر AppImage)

مراحل:

۱. وضعیت فعلی را بگیر:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/patch-zcode.mjs" --status
```

۲. اگر `patched:false` بود (یا کاربر خواسته دوباره اعمال شود)، پچ را اجرا کن. اگر مسیر AppImage در آرگومان‌ها بود به `--appimage` بده؛ اگر نه، اسکریپت خودش `~/Applications/ZCode.AppImage` را پیدا می‌کند:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/patch-zcode.mjs" --appimage "$ARGUMENTS"
```

۳. نتیجه را گزارش بده و به کاربر یادآوری کن:

- زکدِ در حال اجرا تغییری نمی‌کند؛ باید زکد را ببندد و از لانچر **ZCode RTL** (`~/.local/bin/zcode-rtl` یا آیکون منوی اپلیکیشن‌ها) اجرا کند.
- اگر فونت فارسی خاصی می‌خواهد، دستور `/rtl:font` را پیشنهاد بده.

اگر خطای `out/renderer/index.html not found` یا مشابه دیدی، نسخهٔ زکد ساختارش عوض شده — خطا را کامل گزارش کن و به `--uninstall` برای بازگردانی اشاره کن.
