---
name: etsy-manager
description: Manage Etsy shop products and listings — search, create, update, delete listings, upload images, edit inventory/stock and quantity, shipping profiles, orders. Use when the user wants to manage their Etsy shop or Etsy products (Etsy ürün/mağaza yönetimi, ilan oluşturma/güncelleme/silme, stok, fiyat).
---

# etsy-manager

Etsy Open API v3 üzerinden mağaza ve ürün (listing) yönetimi. MCP server
(`etsy-manager`) 41 araç sunar; önemli olanlar:

**Kimlik & mağaza**
- `authenticate` — ilk kullanımda bir kez çağrılır; Etsy OAuth onay URL'ini **sohbete döndürür** (bloklamaz). Kullanıcı URL'i onaylayınca tokenlar `~/.etsy-mcp/tokens.json`'a kaydedilir ve otomatik yenilenir. Sunucuda tarayıcı yoksa (VPS) kullanıcıya SSH tüneli kurmasını söyle: `ssh -L 3737:localhost:3737 <user>@<sunucu>`, sonra URL'i yerel tarayıcısında açması yeterli. Sonucu kontrol etmek için `authenticate`'i tekrar çağır.
- `get_me` — oturum açan kullanıcı; `get_shop` / `get_listings_by_shop` — mağaza bilgisi ve ilanlar

**Ürün/listing yönetimi**
- `search_listings`, `get_listing` — bulma ve detay (başlık, fiyat, stok, link, görsel)
- `create_draft_listing` — yeni ürün taslağı oluştur
- `update_listing` — başlık, açıklama, fiyat, miktar, durum (active/draft) güncelle
- `delete_listing` — ilanı sil
- `get_listing_images`, `upload_listing_image`, `upload_listing_video`, `delete_listing_image` — görsel/video yönetimi
- `get_listing_inventory`, `update_listing_inventory` — varyant ve stok yönetimi
- `get_buyer_taxonomy`, `get_taxonomy_properties` — doğru kategori ve zorunlu alanlar için

**Destekleyenler**
- `manage_shop_sections`, `get_shipping_profiles`, `manage_return_policy`, `get_shop_receipts`, `create_shipment`, `get_reviews_by_shop`

## Çalışma kuralları

1. **Token yoksa** önce `authenticate` çağır; hata "no tokens" / 401 içeriyorsa tekrar dene.
2. **Yeni listing oluştururken**: kategori zorunludur → önce `get_buyer_taxonomy` ile doğru `taxonomy_id`'yi bul, gerekirse `get_taxonomy_properties` ile zorunlu özellikleri al. `quantity`, `price`, `who_made`, `when_made`, `weight` gibi zorunlu alanları Kontrol et. Listing taslak olarak oluşur; yayına almak `update_listing` ile `state: "active"` yapılır.
3. **Fiyat/stok güncellemesinde**: listing ID'yi `get_listings_by_shop` veya `search_listings` ile doğrula; değişiklik öncesi mevcut değeri oku.
4. **Silme işlemlerinde** kullanıcıdan listing adı/ID ile açık onay al.
5. API limiti 10 istek/sn; toplu işlemlerde listing'leri tek tek, kısa aralıklarla güncelle.
6. Görsel yüklerken yerel dosya yolunu mutlak yol olarak ver.

## Kurulum (ilk kullanım)

1. https://www.etsy.com/developers/apps adresinden (gerekirse yeni) app'inin **keystring** ve **shared secret** değerlerini al.
2. `~/.etsy-mcp/config.json` dosyasını oluştur:
   `{ "apiKey": "keystring...", "sharedSecret": "sharedsecret..." }`
   (App'in callback URL'si `http://localhost:3737/callback` olmalı.)
3. Sohbette "Etsy'ye bağlan" de; `authenticate` aracı onay URL'ini döndürür. Headless sunucuda
   (VPS) kullanıcıya önce `ssh -L 3737:localhost:3737 <user>@<sunucu>` tünelini açmasını öner,
   sonra URL'i yerel tarayıcısında açmasını söyle. Halihazırda yetkili bir makineden
   `~/.etsy-mcp/tokens.json` kopyalanırsa OAuth adımı atlanır.

Kaynak: aserper/etsy-mcp (MIT) — plugin içine vendor'lanmış ve sabit callback portu (3737) için yamalanmıştır.
