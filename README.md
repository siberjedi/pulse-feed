# 🔥 AI Survivor — Kurulum

## Gereksinimler
- [Node.js](https://nodejs.org) (v18 veya üstü)

## Kurulum (3 komut)

```bash
cd ai-survivor
npm install
npm start
```

## İlk Açılışta

Uygulama açıldığında çekirdek AI'lar kendi gerçek sitesinde açılır:
- 🔮 Claude → claude.ai
- ⚙️ GPT-4o → chatgpt.com
- 💎 Gemini → gemini.google.com
- 🦙 Meta AI → meta.ai

Opsiyonel AI'lar (admin menüsünden aç/kapat):
- 🧠 DeepSeek → chat.deepseek.com
- 🌪️ Mistral AI → chat.mistral.ai
- 🦙 Llama → meta.ai

Her birinde kendi hesabınla giriş yap. Session kaydolur, bir daha sormaz.

## Kullanım

### Layout Modları
- **HEPSİ** — 5 panel yan yana
- **ODAK** — tab'a tıklayarak tek AI tam ekran

### Broadcast
- Alttaki input'a yaz, Enter veya GÖNDER ⚡ butonuna bas
- Chips'lerden istediğin AI'ları seç/çıkar
- Hepsi aynı anda mesajı alır

### Admin / Turnuva Menüsü
- Üst çubuktaki `▾` butonuyla gizli menüyü aç
- **AI Admin** bölümünden opsiyonel AI'ları aktif/pasif yap
- **Oyuncular**, **Eleme Oylaması** ve **Puanlama** bölümleri buradan yönetilir
- Sonuç metinleri kopyalanabilir

## Notlar
- Selector injection site güncellemelerinde kırılabilir
- Kırılırsa `main.js` içindeki ilgili `inject script`'i güncelle
- Her AI'ın session'ı ayrı tutulur (`persist:siteId`)
