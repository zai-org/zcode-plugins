# etsy-manager (Türkçe)

Etsy mağaza ve ürün (listing) yönetimi için ZCode plugin'i. İçinde vendor'lanmış
[aserper/etsy-mcp](https://github.com/aserper/etsy-mcp) (MIT) MCP server'ı barındırır:
Etsy Open API v3 üzerinden 41 araç — listing create/update/delete, görsel/video yükleme,
envanter/stok, kargo profilleri, siparişler, yorumlar.

Plugin **tek başına (standalone)** çalışır: MCP sunucusu esbuild ile tek bir
bağımlılıksız dosyaya derlenir (`vendor/etsy-mcp/server-bundle.mjs`, ~1.3 MB) ve
Windows / Linux / macOS üzerinde `npm install` gerektirmeden çalışır. Plugin
içinde kimlik bilgisi tutulmaz — anahtarlar ortam değişkenlerinden veya
`~/.etsy-mcp/config.json`'dan okunur.

[English README](./README.md) · [中文说明](./README_CN.md)

## Gereksinimler

- ZCode (Desktop veya CLI)
- **Node.js ≥ 20** PATH'te (`node` komutu çalışmalı). VPS'te: `nvm install 22` veya NodeSource.

## Kurulum (ilk kullanım)

1. https://www.etsy.com/developers/apps → app'in **keystring** (`apiKey`) ve **shared secret** (`sharedSecret`) değerlerini al. Yeni app kaydında callback URL olarak `http://localhost:3737/callback` gir.
2. `~/.etsy-mcp/config.json` oluştur:
   ```json
   { "apiKey": "keystring...", "sharedSecret": "sharedsecret..." }
   ```
   (`ETSY_API_KEY` / `ETSY_SHARED_SECRET` ortam değişkenleri önceliklidir.)
3. Sohbette "Etsy'ye bağlan" de → `authenticate` aracı OAuth onay URL'ini döndürür. Bir kez onayla; tokenlar `~/.etsy-mcp/tokens.json`'a kaydedilir ve otomatik yenilenir.

### Headless sunucular / VPS

`authenticate` aracı onay URL'ini doğrudan sohbete döndürür ve beklemez. Sunucuda
tarayıcı yoksa callback portunu SSH ile kendi bilgisayarına taşı:

```bash
ssh -L 3737:localhost:3737 user@vps
```

`ETSY_NO_BROWSER=1` ortam değişkeni tarayıcı açma denemesini tamamen kapatır.
Alternatif: halihazırda yetkili bir makineden `~/.etsy-mcp/tokens.json` dosyasını
kopyalarsan OAuth'u tamamen atlarsın (tokenlar makineye bağlı değildir; dosya
hassastır, güvenli taşı).

## VPS / Linux üzerinde zcode CLI ile

```bash
# yerel makineden:
rsync -a --exclude '.video_agent' --exclude '.git' /c/Projects/etsyplugin/ user@vps:~/etsyplugin/
# veya GitHub marketplace'i VPS'teki ZCode'a ekle (Settings → Plugin Management → Discover → +)
```

1. Node.js ≥ 20 kur.
2. Marketplace'i ekle (repo URL'si veya klasör), **Personal** altından **etsy-manager → Install**.
3. `~/.etsy-mcp/config.json` dosyasını oluştur (yukarıda).
4. "Etsy'ye bağlan" de → SSH tüneli + yerel tarayıcı ile onayla (veya token kopyala).

## Vendor'a uygulanan yamalar

- OAuth callback portu sabitlendi (varsayılan 3737, `ETSY_CALLBACK_PORT` ile değiştirilebilir).
- Kimlik bilgileri `~/.etsy-mcp/config.json` üzerinden okunur (env değişkenleri önceliklidir).
- Headless/VPS desteği: onay URL'i tarayıcı açılmadan önce hem stderr'e yazılır hem de
  `authenticate` sonucunda döner; araç bloklamaz; tarayıcı açma hatası akışı bozmaz;
  `ETSY_NO_BROWSER=1` tarayıcı denemesini kapatır.
- Callback sunucusu yalnızca `127.0.0.1`'e bağlanır (SSH tüneliyle uyumlu, VPS'te dışa kapalı);
  port doluysa net hata verir.

## Yan etkiler

- Yerel bir MCP server (`node scripts/mcp-server.mjs`) çalıştırır; `api.etsy.com` /
  `www.etsy.com` adreslerine HTTPS istekleri yapar.
- OAuth sırasında en fazla 2 dakika `127.0.0.1:3737`'de geçici bir HTTP sunucusu açar
  ve onay URL'ini tarayıcıda açmayı dener (`ETSY_NO_BROWSER=1` ile atlanır).
- Yalnızca `~/.etsy-mcp/` içine yazar (senin oluşturduğun `config.json`, yönetilen
  `tokens.json`). Başka hiçbir dosyaya dokunmaz.

## Yapı

```
.zcode-plugin/plugin.json          plugin manifest
.mcp.json                          MCP server tanımı (node scripts/mcp-server.mjs)
scripts/mcp-server.mjs             kimlik okuyan launcher
skills/etsy-manager/SKILL.md       kullanım kılavuzu
vendor/etsy-mcp/server-bundle.mjs  bağımlılıksız MCP sunucusu (esbuild bundle)
vendor/etsy-mcp/src/               yamalanmış upstream TypeScript kaynakları
```

## Lisans

MIT — Copyright (c) 2026 [Hugo](https://gozutok.info). Vendor'lanmış
[aserper/etsy-mcp](https://github.com/aserper/etsy-mcp) MIT lisanslıdır
([lisansı](./vendor/etsy-mcp/LICENSE)).
