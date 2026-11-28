---
description: Install a Persian font and set it as the chat font of the ZCode RTL Fixer
allowed-tools: Bash(node:*), Bash(fc-list:*)
---

# /rtl:font — نصب/تغییر فونت فارسی

Args: $ARGUMENTS — یکی از: خالی (Vazirmatn پیش‌فرض)، نام فونتِ نصب‌شده روی سیستم (مثل `IRANSansX`)، یا URL مستقیم فایل فونت (ttf/otf/woff2/zip).

مراحل:

۱. اگر آرگومان URL بود یا خالی:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install-font.mjs" --url "$ARGUMENTS"
```

۲. اگر آرگومان نام فونتِ سیستم بود، اول با `fc-list` وجودش را چک کن. اگر نبود به کاربر بگو یا URL بدهد یا خودش فایل را در `~/.fonts` بگذارد و `fc-cache -f` بزند.

۳. تنظیمات را به‌روز کن (نام خانواده را با فونت‌های fallback فارسی ترکیب کن):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/settings.mjs" set '{"fontFamily":"<نام-خانواده>, Vazirmatn, IRANSansX, Sahel, Tahoma, sans-serif"}'
```

۴. برای اعمال، re-patch لازم است:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/patch-zcode.mjs"
```

۵. گزارش: کدام فونت نصب شد، تنظیمات چیست، و یادآوریِ راه‌اندازی مجدد از لانچر «ZCode RTL».
