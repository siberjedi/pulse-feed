const { app, BrowserWindow, BrowserView, ipcMain } = require('electron')
const path = require('path')

const DESKTOP_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
const GEMINI_FALLBACK_URL = 'https://gemini.google.com/app'

/* ═══════════════════════════════════════════
   AI SITES CONFIG
═══════════════════════════════════════════ */
const AI_SITES = [
  { id: 'claude',  name: 'Claude',  emoji: '🔮', url: 'https://claude.ai',              color: '#c4b5fd' },
  { id: 'chatgpt', name: 'GPT-4o',  emoji: '⚙️', url: 'https://chatgpt.com',            color: '#6ee7b7' },
  { id: 'grok',    name: 'Grok',    emoji: '⚡', url: 'https://grok.com',               color: '#fcd34d' },
  { id: 'gemini',  name: 'Gemini',  emoji: '💎', url: 'https://gemini.google.com/',     color: '#7dd3fc' },
  { id: 'meta',    name: 'Meta AI', emoji: '🦙', url: 'https://www.meta.ai',            color: '#fdba74' },
]

/* ═══════════════════════════════════════════
   INJECTION SCRIPTS
   Her site için mesajı input'a yaz ve gönder
═══════════════════════════════════════════ */
function getInjectScript(siteId, text) {
  const t = JSON.stringify(text)

  const scripts = {
    claude: `(function() {
      const el = document.querySelector('[contenteditable="true"]')
      if (!el) return 'no_input'
      el.focus()
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      sel.removeAllRanges()
      sel.addRange(range)
      document.execCommand('insertText', false, ${t})
      setTimeout(() => {
        const btn = document.querySelector('button[aria-label*="Send"], button[aria-label*="send"], fieldset button[type="submit"]')
        if (btn && !btn.disabled) { btn.click(); return }
        el.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true }))
      }, 400)
      return 'ok'
    })()`,

    chatgpt: `(function() {
      const el = document.querySelector('#prompt-textarea')
               || document.querySelector('textarea[data-id]')
               || document.querySelector('textarea')
      if (!el) return 'no_input'
      el.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(el, ${t})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      setTimeout(() => {
        const btn = document.querySelector('[data-testid="send-button"]')
                 || document.querySelector('button[aria-label*="Send"]')
        if (btn && !btn.disabled) { btn.click(); return }
        el.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true }))
      }, 400)
      return 'ok'
    })()`,

    grok: `(function() {
      const el = document.querySelector('textarea')
      if (!el) return 'no_input'
      el.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(el, ${t})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      setTimeout(() => {
        const btn = document.querySelector('button[type="submit"]')
                 || document.querySelector('button[aria-label*="Send"]')
        if (btn && !btn.disabled) { btn.click(); return }
        el.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true }))
      }, 400)
      return 'ok'
    })()`,

    gemini: `(function() {
      const el = document.querySelector('.ql-editor[contenteditable="true"]')
              || document.querySelector('rich-textarea [contenteditable="true"]')
              || document.querySelector('[contenteditable="true"]')
      if (!el) return 'no_input'
      el.focus()
      document.execCommand('selectAll', false, null)
      document.execCommand('insertText', false, ${t})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      setTimeout(() => {
        const btn = document.querySelector('button[aria-label*="Send"]')
                 || document.querySelector('.send-button')
                 || document.querySelector('button[jsname]')
        if (btn && !btn.disabled) { btn.click(); return }
        el.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true }))
      }, 400)
      return 'ok'
    })()`,

    meta: `(function() {
      const el = document.querySelector('div[contenteditable="true"]')
              || document.querySelector('textarea')
      if (!el) return 'no_input'
      el.focus()
      if (el.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(el, ${t})
        el.dispatchEvent(new Event('input', { bubbles: true }))
      } else {
        document.execCommand('selectAll', false, null)
        document.execCommand('insertText', false, ${t})
      }
      setTimeout(() => {
        const btn = document.querySelector('button[aria-label*="Send"]')
                 || document.querySelector('button[type="submit"]')
        if (btn && !btn.disabled) { btn.click(); return }
        el.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true }))
      }, 400)
      return 'ok'
    })()`,
  }

  return scripts[siteId] || scripts.grok
}

/* ═══════════════════════════════════════════
   LAYOUT CONSTANTS
═══════════════════════════════════════════ */
const TOP_BAR    = 54   // tab bar height
const BOTTOM_BAR = 76   // broadcast bar height
let mainWindow
let views = {}          // { siteId: BrowserView }
let currentLayout = 'split'   // 'split' | 'focus'
let focusedId = 'claude'

/* ═══════════════════════════════════════════
   LAYOUT ENGINE
═══════════════════════════════════════════ */
function applyLayout() {
  const { width, height } = mainWindow.getContentBounds()
  const viewHeight = height - TOP_BAR - BOTTOM_BAR
  const count = AI_SITES.length

  if (currentLayout === 'focus') {
    AI_SITES.forEach(site => {
      const v = views[site.id]
      if (!v) return
      if (site.id === focusedId) {
        v.setBounds({ x: 0, y: TOP_BAR, width, height: viewHeight })
        mainWindow.addBrowserView(v)
      } else {
        mainWindow.removeBrowserView(v)
      }
    })
  } else {
    // split: 5 yan yana
    const panelW = Math.floor(width / count)
    AI_SITES.forEach((site, i) => {
      const v = views[site.id]
      if (!v) return
      const x = i * panelW
      const w = (i === count - 1) ? width - x : panelW  // son panel kalan genişliği alsın
      v.setBounds({ x, y: TOP_BAR, width: w, height: viewHeight })
      mainWindow.addBrowserView(v)
    })
  }
}

/* ═══════════════════════════════════════════
   APP INIT
═══════════════════════════════════════════ */
app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#050508',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadFile('index.html')

  // BrowserView'ları oluştur
  AI_SITES.forEach(site => {
    let retriedWithGeminiFallback = false
    const view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: `persist:${site.id}`,  // Her AI'ın kendi session'ı — giriş hatırlanır
      },
    })
    views[site.id] = view
    view.webContents.setUserAgent(DESKTOP_CHROME_UA)
    view.webContents.loadURL(site.url)

    // Yükleme tamamlandığında UI'a bildir
    view.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('status-update', { id: site.id, status: 'ready' })
    })
    view.webContents.on('did-start-loading', () => {
      mainWindow.webContents.send('status-update', { id: site.id, status: 'loading' })
    })
    view.webContents.on('did-fail-load', (_, code, desc, url, isMainFrame) => {
      if (!isMainFrame) return

      if (site.id === 'gemini' && !retriedWithGeminiFallback && url !== GEMINI_FALLBACK_URL) {
        retriedWithGeminiFallback = true
        view.webContents.loadURL(GEMINI_FALLBACK_URL)
        return
      }

      mainWindow.webContents.send('status-update', {
        id: site.id,
        status: `error:${code}:${desc}`,
      })
    })
  })

  mainWindow.webContents.on('did-finish-load', () => {
    applyLayout()
    mainWindow.webContents.send('views-ready', AI_SITES)
  })

  // Pencere boyutu değişince layout yenile
  mainWindow.on('resize', () => applyLayout())
})

/* ═══════════════════════════════════════════
   IPC HANDLERS
═══════════════════════════════════════════ */

// Broadcast: seçilen AI'lara mesaj gönder
ipcMain.handle('broadcast', async (_, text, targets) => {
  const results = {}
  const targetList = targets && targets.length ? targets : AI_SITES.map(s => s.id)

  await Promise.all(targetList.map(async (siteId) => {
    const view = views[siteId]
    if (!view) { results[siteId] = 'no_view'; return }
    try {
      const script = getInjectScript(siteId, text)
      const result = await view.webContents.executeJavaScript(script)
      results[siteId] = result
    } catch (e) {
      results[siteId] = 'error: ' + e.message
    }
  }))

  return results
})

// Layout değiştir
ipcMain.handle('set-layout', (_, mode, focusId) => {
  currentLayout = mode
  if (focusId) focusedId = focusId
  applyLayout()
  return { ok: true }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
