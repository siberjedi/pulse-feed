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

Uygulama açıldığında her AI kendi gerçek sitesinde açılır:
- 🔮 Claude → claude.ai
- ⚙️ GPT-4o → chatgpt.com
- ⚡ Grok → grok.com
- 💎 Gemini → gemini.google.com
- 🦙 Meta AI → meta.ai

Her birinde kendi hesabınla giriş yap. Session kaydolur, bir daha sormaz.

## Kullanım

### Layout Modları
- **HEPSİ** — 5 panel yan yana
- **ODAK** — tab'a tıklayarak tek AI tam ekran

### Broadcast
- Alttaki input'a yaz, Enter veya GÖNDER ⚡ butonuna bas
- Chips'lerden istediğin AI'ları seç/çıkar
- Hepsi aynı anda mesajı alır

## Notlar
- Selector injection site güncellemelerinde kırılabilir
- Kırılırsa `main.js` içindeki ilgili `inject script`'i güncelle
- Her AI'ın session'ı ayrı tutulur (`persist:siteId`)
