# AI Survivor Proxy Setup (Windows / macOS / Linux)

## Why this error happens on Windows
If you see:

`npm.ps1 cannot be loaded because running scripts is disabled on this system`

PowerShell execution policy is blocking npm's PowerShell wrapper.

---

## Fastest workaround (no policy change)
Run these in **PowerShell**:

```powershell
npm.cmd install
npm.cmd run proxy
```

This bypasses `npm.ps1` and uses `npm.cmd` directly.

---

## Alternative fix (allow scripts for current user)

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Close and reopen PowerShell, then run:

```powershell
npm install
npm run proxy
```

---

## If policy cannot be changed
Use **Command Prompt (cmd.exe)** instead of PowerShell:

```cmd
npm install
npm run proxy
```

---

## Verify proxy is up

Open in browser:

- `http://localhost:3001/health`

Expected JSON:

```json
{"ok":true,"service":"ai-survivor-proxy"}
```

---

## Admin panel setting
In the app, set provider **Proxy URL** to:

`http://localhost:3001/relay?target={url}`
