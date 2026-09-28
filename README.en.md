# ZCode Touch (Mobile Web & PWA)

<p align="center">
  <strong>ZCode adapted for smartphones and tablets: lag-free touch typing, native PWA layout, background notifications without VPN, and full Russian localization.</strong>
</p>

<p align="center">
  <a href="README.md">Русский</a> • <strong>English</strong> • <a href="README.upstream-zh.md">Original README (中文)</a> • <a href="README.upstream-en.md">Original Upstream (EN)</a>
</p>

<p align="center">
  <a href="#why-this-fork-the-problem-with-original-web-app">Why this fork</a> •
  <a href="#comparison-with-original-web-app">Comparison</a> •
  <a href="#key-improvements-by-priority">Key Features</a> •
  <a href="#quickstart">Quickstart</a> •
  <a href="#security--disclaimer">Security</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platforms-iOS%20Safari%20%7C%20Android%20Chrome%20%7C%20Desktop-blue?style=flat-square" alt="Platforms" />
  <img src="https://img.shields.io/badge/PWA-Standalone%20Ready-success?style=flat-square" alt="PWA Ready" />
  <img src="https://img.shields.io/badge/License-Apache%202.0-orange?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/i18n-Russian%20(100%25)-green?style=flat-square" alt="Russian 100%" />
</p>

---

## Why this fork (The Problem with Original Web App)

The original ZCode web client (`zcode --web`) was designed as a direct translation of the desktop Electron app into a desktop browser. Trying to use it from a smartphone over local Wi-Fi or on the go was frustrating:

1. **Severe input lags in mobile Safari:** On every keystroke or backspace, the original code synchronously re-rendered the entire application tree (4,000+ lines of React components) and re-serialized Markdown AST. Correcting a partially typed word caused WebKit to freeze for 1–2 seconds.
2. **Aggressive virtual keyboard autofocus:** Desktop code triggered `focus()` on every app mount, new task creation, and session switch. On iOS, the virtual keyboard forcibly popped up and obstructed half the conversation.
3. **Desktop-locked layout on touch screens:** Lacking mobile drawers, sidebars squeezed the conversation pane 50/50, collapsing the chat area down to an unreadable 100px sliver.
4. **iOS rubber-banding and random page zoom:** Scrolling the message stream dragged the entire Safari window off-screen, while tapping inputs triggered unwanted viewport zooming.
5. **Broken media attachments over local HTTP:** Uploading images failed with `checksumUnavailable` because desktop code demanded WebCrypto `crypto.subtle` (unavailable on non-secure LAN HTTP). Clipboard copying was similarly broken.
6. **No mobile background notifications:** Running long agent tasks forced users to keep the phone screen awake, with zero alerts when tasks finished or failed.
7. **Session loss on mobile memory reclaim:** The server only accepted a single workspace path, and iOS frequently wiped background tabs, throwing users back into empty drafts.

**The goal of ZCode Touch:** Transform ZCode into a first-class, pocket-sized AI agent workstation that feels as fast and natural from your phone as it does at your desk.

---

## Comparison with Original Web App

| Feature / Scenario | Original ZCode Web | ZCode Touch (This Fork) |
| :--- | :--- | :--- |
| **iPhone typing** | Freezes and stutter on typing and backspacing | ⚡ **Instant zero-lag typing** (debounced drafts, input fast-path) |
| **Virtual keyboard** | Forcibly pops up on every navigation | 📱 **Opens only on explicit tap** into the composer input |
| **Mobile layout** | Panes crush the chat 50/50 into a slit | 🎨 **Smooth drawer overlays** with backdrops & close buttons |
| **iOS scrolling** | Screen rubber-banding & unwanted zoom | 🧈 **Momentum scrolling**, locked viewport (`overscroll: none`) |
| **Background alerts** | Only works while tab stays open | 🔔 **ntfy.sh push notifications** on completion/error (no VPN) |
| **Attachments over LAN HTTP** | Fails with `checksumUnavailable` | 📎 **Pure JS SHA-256 fallback**, photo uploads work over Wi-Fi |
| **Languages** | English / Chinese | 🌐 **100% Russian localization** (5,400+ keys) + toggle button |
| **Workspaces** | Single workspace only | 📁 **Multi-workspace** (`dir1;dir2`), conversations pane enabled |
| **PWA memory discard** | Resets to primary project or blank draft | 💾 **Automatic restoration** of your last active session |

---

## Key Improvements (By Priority)

### 1. ⚡ Zero-Lag Mobile Composer & Smart Keyboard Focus
* **Debounced Draft Persistence:** Draft updates are debounced (350ms), decoupling typing from heavy parent re-renders.
* **Input Fast-Path:** Eliminated synchronous full DOM tree traversal on every `beforeinput` event in WebKit.
* **Smart Autofocus:** Coarse-touch screens (≤767px) skip intrusive autofocus, keeping the keyboard closed until you explicitly tap the field.
* **Touch Action Buttons:** Copy and edit message actions remain visible on touch devices without needing mouse hover (`@media(hover:none)`).

### 2. 📱 Native Mobile Touch UI & Standalone PWA
* **Floating Drawers:** Left sidebar and right code/preview inspector slide in as GPU-accelerated touch drawers (`transform`) with background dimming and close buttons.
* **Fixed iOS Rubber-Banding:** Viewport locked at the `html, body` level (`overflow: hidden`, `overscroll-behavior: none`, `touch-action: manipulation`).
* **Zoom Prevention:** Composer font size locked to `16px !important` to prevent Safari auto-zoom on focus.
* **Hardware Momentum Scrolling:** Smooth long session scrolling via `-webkit-overflow-scrolling: touch` and CSS style isolation (`will-change: transform`, `contain: layout style`).
* **Tool Call Error Details:** Open via tap Popover rather than desktop hover tooltips.

### 3. 🔔 Background Alerts via ntfy (Zero-Config over Local HTTP)
* Server automatically sends a POST request to `https://ntfy.sh/<secret_topic>` upon task completion or failure.
* Works over plain HTTP LAN: install the free **ntfy** app on iOS / Android and subscribe to your server's topic.
* Receive push alerts and sounds even when your phone is locked and the browser is closed.

### 4. 🌐 Full Russian Localization
* 5,472 localized interface strings verified with an engineering glossary.
* Instant language toggle ("Ру") located in the sidebar footer.
* Native `ru-RU` schema integration in `@zcode/shared` prevents server Zod validation errors.

### 5. 📁 Multi-Workspace & Resilient Sessions
* `ZCODE_SERVER_WORKSPACE` supports semicolon-separated paths (`path1;path2`).
* Conversations workspace appears as a project row, preventing lost chats.
* Session restoration (`restoreOnFreshLoad`): Reopening the PWA returns you directly to your active chat.
* Windows 8.3 path normalization (`realpathSync.native`) prevents libuv `fs-event` crashes.

### 6. 🔌 Stable MCP Tools & LAN Polyfills
* Fixes MCP startup race condition: delayed stdio servers are registered on later turns (`collectLateArrivals`).
* Linked `mcpSyncService` RPC enables viewing and toggling MCP servers in web settings.
* Pure JS SHA-256 fallback enables image uploads without HTTPS WebCrypto.
* Clipboard polyfill for plain HTTP connections.

---

## Quickstart

### Method 1: Prebuilt Standalone Installer (Recommended)

Install with a single command on any machine with Node.js (Linux, macOS, WSL, Git Bash):

```bash
curl -fsSL https://github.com/v9n9yphb67-ui/ZCode/releases/download/v3.14.0-web/install.sh | sh
```

Start the web server for your local network:
```bash
zcode --web --host 0.0.0.0 --port 3040
```

Access the server from your phone:
```
http://192.168.x.x:3040/?token=YOUR_TOKEN
```

### Method 2: Run from Source

```bash
git clone -b iphone-web https://github.com/v9n9yphb67-ui/ZCode.git
cd ZCode

pnpm install
pnpm --filter @zcode/server build
pnpm --filter @zcode/web build

PORT=3040 ZCODE_SERVER_HOST=0.0.0.0 node packages/server/dist/entry-http.js
```

### Adding to Home Screen (PWA)

1. Open your server URL in **Safari on iPhone** (or Chrome on Android).
2. Tap **Share** -> **Add to Home Screen**.
3. Launch ZCode Touch from your home screen as a fullscreen standalone app.

---

## Security & Disclaimer

* **Trusted Local Network (LAN):** Intended for private home Wi-Fi or private VPNs (WireGuard, Tailscale, OpenVPN).
* **Do not expose port 3040 directly to the public internet** without HTTPS encryption and a reverse proxy (Caddy, Nginx, Cloudflare Tunnel).
* Auth tokens are stored in your PWA's `localStorage`. Regularly rotate tokens when changing networks.

---

## License

ZCode is originally created by [zai-org/ZCode](https://github.com/zai-org/ZCode) and licensed under the **Apache License 2.0**.
All original licenses (`LICENSE`), notices (`NOTICE.md`), and third-party attributions are preserved.
