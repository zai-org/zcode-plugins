---
name: rtl-fixer
description: Use when the user wants to fix mixed Persian/English (bidi) text rendering in the ZCode Desktop chat box — install, configure fonts, change settings, update, repair or uninstall the ZCode RTL Fixer plugin, or when they report Persian text being left-aligned/scrambled in ZCode.
---

# ZCode RTL Fixer

این اسکیل ابزارِ مدیریتی پلاگین «ZCode RTL Fixer» است: پلاگینی که با تزریق یک بوت‌استرپ سبک به UI دسکتاپ زکد، متن‌های مخلوط فارسی/انگلیسی چت‌باکس را راست‌چین و با فونت فارسی خوانا نشان می‌دهد؛ بلاک‌های کد دست‌نخورده می‌مانند.

## معماری (مهم برای عیب‌یابی)

- اپ دسکتاپ زکد، UI را از `out/renderer/index.html` داخل `resources/app.asar` سرو می‌کند (پروتکل `zcode://`، بدون CSP).
- پلاگین یک **نسخهٔ استخراج‌شدهٔ AppImage** را در `~/.local/share/zcode-rtl-fixer/app` نگه می‌دارد، `app.asar` آن را پچ می‌کند (append بوت‌استرپ + تگ اسکریپت در index.html) و **نسخهٔ اصلی را دست‌نخورده نگه می‌دارد** (`app.asar.orig`). AppImage اصلی کاربر هرگز تغییر نمی‌کند.
- راه‌اندازی از طریق `~/.local/bin/zcode-rtl` یا آیکون «ZCode RTL» در منوی اپلیکیشن‌ها.
- تنظیمات کاربر: `~/.zcode/rtl-fixer/settings.json` (با کلیدهای `enabled`, `fontEnabled`, `fontFamily`, `fontSizeScale`, `fixTables`, `fixLists`, `mainLauncher`, `probe`) و هنگام پچ داخل بوت‌استرپ bake می‌شود → **هر تغییر تنظیمات نیاز به re-patch دارد** که سریع است (چند ثانیه).
- `mainLauncher: true` یعنی لانچر اصلی «ZCode» (`~/.local/share/applications/zcode.desktop`) هم به نسخهٔ پچ‌شده pointer می‌شود — Exec عوض می‌شود، بقیهٔ خطوط (نوع، آیکون، MimeType) دست‌نخورده می‌ماند و نسخهٔ اصلی در `zcode.desktop.bak-rtl` نگه داشته می‌شود. `--uninstall` آن را برمی‌گرداند. AppImage اصلی هرگز تغییر نمی‌کند.

## اسکریپت‌ها (همه با Node، بدون وابستگی)

همهٔ مسیرها نسبت به ریشهٔ این پلاگین (`${CLAUDE_PLUGIN_ROOT}` یا مسیر سورس):

```bash
# نصب / اعمال مجدد (استخراج AppImage + پچ asar + لانچر)
node "${CLAUDE_PLUGIN_ROOT}/scripts/patch-zcode.mjs"

# وضعیت کامل به‌صورت JSON
node "${CLAUDE_PLUGIN_ROOT}/scripts/patch-zcode.mjs" --status

# حذف پچ (بازگردانی asar اصلی، حذف لانچر)
node "${CLAUDE_PLUGIN_ROOT}/scripts/patch-zcode.mjs" --uninstall
node "${CLAUDE_PLUGIN_ROOT}/scripts/patch-zcode.mjs" --purge   # + حذف نسخهٔ استخراج‌شده

# تنظیمات — بعد از set حتماً patch-zcode.mjs را دوباره اجرا کن
node "${CLAUDE_PLUGIN_ROOT}/scripts/settings.mjs" set '{"fontFamily":"Vazirmatn, sans-serif","fontSizeScale":1.05}'

# نصب فونت فارسی (پیش‌فرض: Vazirmatn از GitHub) — سپس re-patch
node "${CLAUDE_PLUGIN_ROOT}/scripts/install-font.mjs"
node "${CLAUDE_PLUGIN_ROOT}/scripts/install-font.mjs" --url https://.../font.ttf

# تست‌های unit (تست real-asar هم اگر AppImage مونت باشد اجرا می‌شود)
node "${CLAUDE_PLUGIN_ROOT}/tests/run-tests.mjs"
```

مسیر AppImage اگر در مکان پیش‌فرض (`~/Applications/ZCode.AppImage`) نباشد: `--appimage /path/to/ZCode.AppImage`.

## گردش‌کارهای معمول

- **نصب**: `--status` بگیر؛ اگر `extracted:false` یا `patched:false` بود `patch-zcode.mjs` را اجرا کن و به کاربر بگو زکد را از لانچر «ZCode RTL» (یا `~/.local/bin/zcode-rtl`) راه‌اندازی کند. زکدِ در حال اجرا تغییر نمی‌کند.
- **تغییر فونت**: اول `install-font.mjs` (اگر فونت روی سیستم نصب نیست)، بعد `settings.mjs set` با نام خانوادهٔ فونت (خروجی `fc-list`)، بعد re-patch.
- **وریفای بصری**: یک نمونهٔ زکد جدا راه‌اندازی کن، اسکرین‌شات بگیر (`scrot -a "x,y,w,h"`) و نگاه کن: متن فارسی باید راست‌چین با فونت فارسی باشد و کد انگلیسی چپ‌چین بماند. برای تست تزریق می‌توانی موقتاً `probe:true` set کنی — عنوان پنجره باید `RTLPROBE-…` شود.
- **کاربر گفت بعد از آپدیت زکد، RTL کار نمی‌کند**: طبیعی است — AppImage جدید است؛ کافی است re-patch (نمونهٔ استخراج‌شده خودکار به‌روز می‌شود چون mtime تغییر کرده).
- **اپ بعد از پچ بالا نمی‌آید**: احتمال فعال‌بودن fuse اعتبارسنجی asar؛ از `--uninstall` استفاده کن و در گزارش ذکر کن.

## محدودیت‌ها

- فقط چت‌باکس دسکتاپ هدف است؛ ترمینال داخلی و ادیتورها تغییر نمی‌کنند.
- پچ برای هر نسخهٔ جدید AppImage باید دوباره اعمال شود (دستور `/rtl:install`).
- اگر zcode آینده CSP یا مسیرهای رندرر را عوض کند، پچ‌ر با خطای واضح متوقف می‌شود (`out/renderer/index.html not found`) — نسخه را به‌روزرسانی کن.

## نکتهٔ عیب‌یابی (v0.2.0)

- `probe` فقط برای تستِ تزریق است (out خط قرمز + تغییر عنوان پنجره) — در استفادهٔ روزمره باید `false` باشد.
- اگر بعد از پچ، متن‌ها هیچ تغییری نکردند: بوت‌استرپ را از asar نصب‌شده بیرون بکش و چک کن `var SETTINGS` یک آبجکت واقعی باشد نه placeholder (`__RTL_SETTINGS__`) — باگ مشابه در v0.1.0 وجود داشت (جایگزینیِ single-occurrence داخل کامنت هدر). تستِ `engine: bootstrap contains placeholder…` جلوی تکرارش را می‌گیرد.
