<p align="center">
  <img src="assets/Statusio.png" width="180" alt="Statusio Title">
</p> 

---

# Statusio — Debrid Account Status
### *A **Self-Hosted** Stremio Add-on*
*Developed by **A1337User***  

A tiny, self-hosted Stremio add-on that shows your **premium status & days remaining** for multiple debrid providers as a single **info card** in the **Streams** tab.

**Note:** *Statusio* will run on a server soon, stay tuned.

---

## Table of Contents
- [Overview](#overview)
- [Supported Providers](#supported-providers)
- [Features](#features)
- [Requirements](#requirements)
- [Folder Location](#folder-location)
- [Quick Start (Windows • CMD as Administrator)](#quick-start-windows--cmd-as-administrator)
- [Install in Stremio Web/Desktop](#install-in-stremio-webdesktop)
- [Configuration (Tokens, Demo Mode, Options)](#configuration-tokens-demo-mode-options)
- [Test the Card](#test-the-card)
- [Nuke & Fix (Wrong Token / Stuck State)](#nuke--fix-wrong-token--stuck-state)
- [Troubleshooting](#troubleshooting)
- [Notes & Tips](#notes--tips)
- [Credits](#credits)
- [License](#license)

---

## Overview
This add-on renders a single **info card** in the **Streams** tab for movies/series/channel/tv indicating your debrid account status:

- ✅ **OK** — active premium until *YYYY-MM-DD*
- 🟡 **Warning** — **≤ 14 days** remaining
- 🟠 **Critical** — **≤ 3 days** remaining
- 🔴 **Expired** — 0 days remaining (or not premium)

It runs locally—**no remote server required**.

### Screenshot

![Statusio](/assets/StatusioUI.png)

*(Example layout shown; provider list & text update dynamically.)*

---

## Supported Providers
- **Real-Debrid** (token: `rd_token` or `RD_TOKEN`)
- **AllDebrid** (key: `ad_key` or `AD_KEY`)
- **Premiumize** (key: `pm_key` / `PM_KEY`; supports `apikey` or `access_token`)
- **TorBox** (token: `tb_token` or `TB_TOKEN`)
- **Debrid-Link** (key: `dl_key` or `DL_KEY`; Bearer or `?apikey=`)

> *You can enable **one or many** providers. The card shows a tidy line per provider.*

---

## Features
- **Local self-hosting** with Node.js
- **Multi-provider** support in one card
- **Config UI** inside Stremio (tokens, provider enable/disable)
- **ENV fallback** for quick testing (`RD_TOKEN`, `AD_KEY`, `PM_KEY`, `TB_TOKEN`, `DL_KEY`)
- **Demo Mode** (*all_active* / *some_off*) to preview without tokens
- **Small in-memory cache** to avoid API spam
- **Compact 6–8 line display** with friendly quotes and renewal nudges

---

## Requirements
- **Windows** (commands below use `CMD`)
- **Node.js** (LTS recommended) → https://nodejs.org
- At least one **debrid API token/key**

> [!IMPORTANT]  
> If a token is saved in **Configure**, it is used first. Otherwise, the server falls back to any **ENV** variable you set in the CMD session.

---

## Folder Location
Use your real path. Example path used in these instructions:

C:\Users\a1337user\Desktop\Stremio Addons\Development\Statusio


---

## Quick Start (Windows • CMD as Administrator)

1. **Open CMD** → **Run as Administrator**

2. **Change directory** to your add-on folder:

```cmd
cd "C:\Users\a1337user\Desktop\Stremio Addons\Development\Statusio"
```

3. **(Optional) Nuke** and old Node process, just in case:

```cmd
taskkill /IM node.exe /F
```
***(If “not found,” that’s fine—proceed.)***

4. **First time only — init & install**
```cmd
npm init -y
npm i stremio-addon-sdk node-fetch
```
5. **Start the add-on** — example with **Real-Debrid** only:
```cmd
set RD_TOKEN=PASTE_REALDEBRID_API_TOKEN_HERE && node index.js
```
Enter your **API Token** to proceed 
6. You should see something like:
```cmd
Statusio at http://127.0.0.1:7042/manifest.json
```


---

## Install in Stremio Web/Desktop
### Stremio Web (if allowed by browser)
1. Open 
```cmd
https://web.stremio.com/#/addons?
```

2. Click **Install via URL** (+ Add).

3. Paste your local URL (from CMD), e.g.:
```cmd
http://127.0.0.1:7042/manifest.json
```
4. Open the add-on card → **Configuration**.

5. Paste your token(s) → **Save** → **Install**.

6. Browser may prompt to open the Desktop app; accept and finish install there.


### Stremio Desktop (recommended for lcoalhost)

1. Open the **Stremio Desktop** app.

2. **Add-ons → Community → Install via URL.**

3. Paste: 
```cmd
http://127.0.0.1:7042/manifest.json
```

4. Open the add-on → **Configure** → paste token(s) → **Save** →  **Install**


[!NOTE] If Stremio Web blocks http:// localhost (mixed content), use the **Desktop app** for local testing.


### Configuration (Tokens, Demo Mode, Options)

Inside the add-on Configure panel:

- **providers_enabled**: select one or more (Real-Debrid, AllDebrid, Premiumize, TorBox, Debrid-Link)

- **cache_minutes**: default 10

- **rd_token / ad_key / pm_key / tb_token / dl_key**: paste your credentials

- **pm_auth**: apikey (default) or oauth (uses access_token)

- **dl_auth**: Bearer (default) or query to append ?apikey=...

- **dl_endpoint**: override if Debrid-Link changes endpoint

- **demo_mode**: off / all_active / some_off

**ENV fallbacks (optional)**: 
- RD_TOKEN, AD_KEY, PM_KEY, TB_TOKEN, DL_KEY, PORT

Examples:

```cmd
set RD_TOKEN=xyz && set PORT=7050 && node index.js
set AD_KEY=abc && set PM_KEY=pm123 && node index.js
```



---

### Test the Card

1. Open any movie (or series/channel/tv).

2. Go to Streams.

3. Look for Statusio (info card).

**Expected titles / states**

- ✅ **OK** — plenty of time left (≥ 15 days)

- 🟡 **Warning** — **≤ 14 days**

- 🟠 **Critical** — **≤ 3 days**

- 🔴 **Expired** — **0 days** or not premium

### Nuke & Fix (Wrong Token / Stuck State)

1. **Kill Node** (clean restart)
```cmd
taskkill /IM node.exe /F
```

2. **Clear env token(s)** if you set them in this CMD session:
```cmd
set RD_TOKEN=
set AD_KEY=
set PM_KEY=
set TB_TOKEN=
set DL_KEY=
```
3. **Relaunch** with the correct token(s)
```cmd
cd "C:\Users\a1337user\Desktop\Stremio Addons\Development\Statusio"
set RD_TOKEN=PASTE_CORRECT_TOKEN_HERE && node index.js
```
4. **If Stremio looks stale**
- Uninstall the add-on and reinstall via URL, **or**
- Bump manifest.version in index.js (e.g., 1.0.2 → 1.0.3) and restart Node.


---

### Troubleshooting
[!WARNING] “**Configure your token**” **card**
No token detected. Paste a token in **Configure**, or launch with an **ENV** token (e.g., RD_TOKEN).

**Config feels ignored**

- Verify you installed from the same **URL/port** you’re running.

- Uninstall duplicate add-on installs (old ports/IDs).

- Keep manifest.id stable between runs.

- Clear env vars so you only test what’s saved in **Configure**.

**Port already in use**
```cmd
set PORT=7010 && set RD_TOKEN=YOUR_TOKEN && node index.js
```

Then install from:

```cmd
http://127.0.0.1:7010/manifest.json
```

**Stremio Web can’t reach localhost**
- Use **Stremio Desktop** for local testing, or run your add-on over **HTTPS**.



---

### Notes & Tips

- Appears as an **info card** in **Streams** (no playback links).

- Default manifest includes ["movie","series","channel","tv"]. Trim if you want fewer surfaces.

- Treat tokens like **passwords**; never commit them to Git.

- **Demo Mode** is perfect for UI checks without real tokens.

- Quotes rotate to keep the card friendly, fun, and safe.



---

### Credits

- Developed by **A1337User**

- Built with **stremio-addon-sdk** and **node-fetch**



---

### License

This project is provided “**as-is,**” without warranty of any kind. Review and adapt to your use-case and jurisdiction. See **LICENSE** if provided.
