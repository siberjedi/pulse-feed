const { app, BrowserWindow, BrowserView, ipcMain } = require('electron')
const path = require('path')

const DESKTOP_CHROME_UA = app.userAgentFallback
  .replace(/Electron\/[^\s]+\s?/i, '')
  .replace(/\s{2,}/g, ' ')
  .trim()
const GEMINI_FALLBACK_URL = 'https://gemini.google.com/app'

/* ═══════════════════════════════════════════
   AI SITES CONFIG
═══════════════════════════════════════════ */
const ALL_AI_SITES = [
  { id: 'claude',  name: 'Claude',  emoji: '🔮', url: 'https://claude.ai',              color: '#c4b5fd' },
  { id: 'chatgpt', name: 'GPT-4o',  emoji: '⚙️', url: 'https://chatgpt.com',            color: '#6ee7b7' },
  { id: 'deepseek',name: 'DeepSeek',emoji: '🧠', url: 'https://chat.deepseek.com',      color: '#fcd34d' },
  { id: 'mistral', name: 'Mistral AI', emoji: '🌪️', url: 'https://chat.mistral.ai/chat', color: '#93c5fd' },
  { id: 'llama',   name: 'Llama',   emoji: '🦙', url: 'https://www.meta.ai',            color: '#fdba74' },
  { id: 'gemini',  name: 'Gemini',  emoji: '💎', url: 'https://gemini.google.com/',     color: '#7dd3fc' },
  { id: 'meta',    name: 'Meta AI', emoji: '🛰️', url: 'https://www.meta.ai',            color: '#fda4af' },
]
const CORE_SITE_IDS = []

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
               || document.querySelector('div#prompt-textarea[contenteditable="true"]')
               || document.querySelector('textarea[data-id]')
               || document.querySelector('textarea')
               || document.querySelector('div[contenteditable="true"][data-testid*="composer"]')
      if (!el) return 'no_input'
      el.focus()

      const isTextarea = el.tagName === 'TEXTAREA'
      if (isTextarea) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        if (setter) setter.call(el, ${t})
        else el.value = ${t}
      } else {
        document.execCommand('selectAll', false, null)
        document.execCommand('insertText', false, ${t})
      }

      el.dispatchEvent(new Event('input', { bubbles: true }))
      setTimeout(() => {
        const btn = document.querySelector('[data-testid="send-button"]')
                 || document.querySelector('button[aria-label*="Send"]')
                 || document.querySelector('button[data-testid*="send"]')
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') { btn.click(); return }
        el.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true }))
      }, 450)
      return 'ok'
    })()`,

    deepseek: `(function() {
      return new Promise((resolve) => {
        const el = document.querySelector('textarea#chat-input')
                || document.querySelector('textarea[placeholder*="Message"]')
                || document.querySelector('textarea[placeholder*="message"]')
                || document.querySelector('textarea')
                || document.querySelector('[role="textbox"][contenteditable="true"]')
                || document.querySelector('div[contenteditable="true"]')
                || document.querySelector('input[type="text"]')
        if (!el) { resolve('no_input'); return }
        el.focus()

        const tag = el.tagName
        const isTextarea = tag === 'TEXTAREA'
        const isTextInput = tag === 'INPUT'
        if (isTextarea || isTextInput) {
          if (isTextarea) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
            if (setter) setter.call(el, ${t})
            else el.value = ${t}
          } else {
            const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
            if (inputSetter) inputSetter.call(el, ${t})
            else el.value = ${t}
          }
          el.dispatchEvent(new Event('change', { bubbles: true }))
        } else {
          document.execCommand('selectAll', false, null)
          document.execCommand('insertText', false, ${t})
        }

        el.dispatchEvent(new Event('input', { bubbles: true }))
        try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${t} })) } catch (_) {}

        setTimeout(() => {
          const btn = document.querySelector('[data-testid="send-button"]')
                  || document.querySelector('button[type="submit"]')
                  || document.querySelector('button[data-testid*="send"]')
                  || document.querySelector('button[aria-label*="Send"]')
                  || document.querySelector('button[aria-label*="Gönder"]')
                  || Array.from(document.querySelectorAll('button')).find(b => {
                      const txt = ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).trim()
                      return /send|gönder|submit|yolla/i.test(txt)
                    })
          if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') { btn.click(); resolve('ok_btn'); return }

          const form = el.closest('form')
          if (form) {
            if (typeof form.requestSubmit === 'function') { form.requestSubmit(); resolve('ok_form'); return }
            if (typeof form.submit === 'function') { form.submit(); resolve('ok_form'); return }
          }

          el.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true }))
          el.dispatchEvent(new KeyboardEvent('keyup', { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true }))
          resolve('ok_enter')
        }, 450)
      })
    })()`,

    mistral: `(function() {
      const el = document.querySelector('textarea')
              || document.querySelector('div[contenteditable="true"]')
              || document.querySelector('[role="textbox"][contenteditable="true"]')
      if (!el) return 'no_input'
      el.focus()
      if (el.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        if (setter) setter.call(el, ${t})
        else el.value = ${t}
      } else {
        document.execCommand('selectAll', false, null)
        document.execCommand('insertText', false, ${t})
      }
      el.dispatchEvent(new Event('input', { bubbles: true }))
      setTimeout(() => {
        const btn = document.querySelector('button[type="submit"]')
                 || document.querySelector('button[aria-label*="Send"]')
                 || document.querySelector('button[data-testid*="send"]')
        if (btn && !btn.disabled) { btn.click(); return }
        el.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true }))
      }, 450)
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

    llama: `(function() {
      const el = document.querySelector('div[contenteditable="true"]')
              || document.querySelector('textarea')
      if (!el) return 'no_input'
      el.focus()
      if (el.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        if (setter) setter.call(el, ${t})
        else el.value = ${t}
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
      }, 450)
      return 'ok'
    })()`,
  }

  return scripts[siteId] || scripts.deepseek
}

/* ═══════════════════════════════════════════
   LAYOUT CONSTANTS
═══════════════════════════════════════════ */
const TOP_BAR    = 54   // tab bar height
const BOTTOM_BAR = 96   // broadcast bar height
const PANEL_HEIGHT = 360
let mainWindow
let views = {}          // { siteId: BrowserView }
let currentLayout = 'split'   // 'split' | 'focus'
let focusedId = 'claude'
let activeSiteIds = ['claude', 'chatgpt', 'gemini', 'meta']
let isPanelOpen = false
let panelReservedHeight = PANEL_HEIGHT

function getSitesByIds(ids) {
  const set = new Set(ids)
  return ALL_AI_SITES.filter(site => set.has(site.id))
}

function getActiveSites() {
  return getSitesByIds(activeSiteIds)
}

function normalizeActiveSiteIds(inputIds = []) {
  const valid = new Set(ALL_AI_SITES.map(s => s.id))
  const ids = Array.from(new Set(inputIds || [])).filter(id => valid.has(id))
  return ids.length ? ids : [ALL_AI_SITES[0].id]
}

/* ═══════════════════════════════════════════
   LAYOUT ENGINE
═══════════════════════════════════════════ */
function applyLayout() {
  if (!mainWindow) return
  const activeSites = getActiveSites()
  if (!activeSites.length) return
  const { width, height } = mainWindow.getContentBounds()
  const reservedBottom = BOTTOM_BAR + (isPanelOpen ? panelReservedHeight : 0)
  const viewHeight = Math.max(120, height - TOP_BAR - reservedBottom)
  const count = activeSites.length

  if (currentLayout === 'focus') {
    activeSites.forEach(site => {
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
    // split: tüm aktif paneller yan yana
    const panelW = Math.floor(width / count)
    activeSites.forEach((site, i) => {
      const v = views[site.id]
      if (!v) return
      const x = i * panelW
      const w = (i === count - 1) ? width - x : panelW  // son panel kalan genişliği alsın
      v.setBounds({ x, y: TOP_BAR, width: w, height: viewHeight })
      mainWindow.addBrowserView(v)
    })
  }
}

function rebuildViews() {
  Object.values(views).forEach(v => {
    try { mainWindow.removeBrowserView(v) } catch (_) {}
    try { v.webContents.destroy() } catch (_) {}
  })
  views = {}

  getActiveSites().forEach(site => {
    let retriedWithGeminiFallback = false
    const view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: `persist:${site.id}`,
      },
    })

    views[site.id] = view
    view.webContents.setUserAgent(DESKTOP_CHROME_UA)
    view.webContents.loadURL(site.url)

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
    autoHideMenuBar: true,
  })

  mainWindow.setMenuBarVisibility(false)

  mainWindow.loadFile('index.html')

  rebuildViews()

  mainWindow.webContents.on('did-finish-load', () => {
    applyLayout()
    mainWindow.webContents.send('views-ready', getActiveSites())
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
  const targetList = targets && targets.length ? targets : getActiveSites().map(s => s.id)

  await Promise.all(targetList.map(async (siteId) => {
    const view = views[siteId]
    if (!view) { results[siteId] = 'no_view'; return }
    try {
      const script = getInjectScript(siteId, text)
      const result = await view.webContents.executeJavaScript(script)
      if (siteId === 'deepseek') {
        if (result === 'no_input') {
          const { width, height } = view.getBounds()
          const x = Math.floor(width * 0.5)
          const y = Math.floor(height * 0.92)
          view.webContents.sendInputEvent({ type: 'mouseMove', x, y })
          view.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
          view.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
          await new Promise(resolve => setTimeout(resolve, 80))
          view.webContents.insertText(text)
          await new Promise(resolve => setTimeout(resolve, 120))
          view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
          view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
          results[siteId] = 'ok_mouse_fallback'
          return
        }
      }
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
  if (focusId && views[focusId]) focusedId = focusId
  if (!views[focusedId]) focusedId = getActiveSites()[0]?.id || 'claude'
  applyLayout()
  return { ok: true }
})

ipcMain.handle('set-panel-open', (_, open) => {
  if (typeof open === 'number') {
    isPanelOpen = open > 0
    panelReservedHeight = Math.max(120, Math.min(1200, Math.floor(open)))
  } else {
    isPanelOpen = Boolean(open)
    if (!isPanelOpen) panelReservedHeight = PANEL_HEIGHT
  }
  applyLayout()
  return { ok: true }
})

ipcMain.handle('get-available-sites', () => {
  return {
    allSites: ALL_AI_SITES,
    coreSiteIds: CORE_SITE_IDS,
    activeSiteIds,
  }
})

ipcMain.handle('set-active-sites', (_, siteIds) => {
  activeSiteIds = normalizeActiveSiteIds(siteIds)
  if (!activeSiteIds.includes(focusedId)) focusedId = activeSiteIds[0]
  rebuildViews()
  applyLayout()
  mainWindow.webContents.send('views-ready', getActiveSites())
  return {
    activeSites: getActiveSites(),
    activeSiteIds,
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
