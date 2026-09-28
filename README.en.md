# ZCode Touch (Mobile Web & PWA)

<p align="center">
  <strong>Mobile adaptation for ZCode: zero-lag touch typing, responsive touch interface, local network notifications, and full Russian localization.</strong>
</p>

<p align="center">
  <a href="README.md">Русский</a> • <strong>English</strong> • <a href="README.upstream-zh.md">Original README (中文)</a> • <a href="README.upstream-en.md">Original Upstream (EN)</a>
</p>

<p align="center">
  <a href="#addressed-upstream-issues">Addressed Issues</a> •
  <a href="#comparison-summary">Comparison</a> •
  <a href="#quickstart">Quickstart</a> •
  <a href="#security">Security</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platforms-iOS%20Safari%20%7C%20Android%20Chrome%20%7C%20Desktop-blue?style=flat-square" alt="Platforms" />
  <img src="https://img.shields.io/badge/PWA-Standalone%20Ready-success?style=flat-square" alt="PWA Ready" />
  <img src="https://img.shields.io/badge/License-Apache%202.0-orange?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/i18n-Russian%20(100%25)-green?style=flat-square" alt="Russian 100%" />
</p>

---

## Addressed Upstream Issues

The original ZCode web interface (`zcode --web`) is architected for desktop browsers and mouse navigation. Accessing it from mobile devices (iOS Safari, Android Chrome, PWA) exposed several critical defects. Below is a breakdown of resolved issues and applied technical fixes.

---

### 1. Text Input & Virtual Keyboard

* **Input latency and freezes during text editing in Safari**
  * *Problem:* On every keypress or backspace, the composer synchronously invoked draft saving, triggering a full re-render of the session view (4,000+ lines of React code), scanning the entire DOM tree during `beforeinput` events, and repeatedly serializing the Markdown AST. WebKit UI threads froze for 1–2 seconds during text edits.
  * *Fix:* Draft persistence is debounced (350ms), a fast-path bypasses heavy DOM traversals during text input, an IME/composition guard (`editor.isComposing()`) prevents freezes, and AST serialization results are cached.

* **Automatic virtual keyboard popups during navigation**
  * *Problem:* Desktop logic triggered `inputApi.focus()` on page mount, tab switches, and session navigation, forcing the mobile virtual keyboard open and covering the viewport.
  * *Fix:* Implemented touch device detection (`isMobileTouchViewport` for viewports ≤767px). Autofocus is skipped during cold starts and tab changes. The keyboard opens strictly on deliberate tap into the input box.

---

### 2. Mobile Layout & Touch Interface

* **Conversation area squeezed by side panels (50/50 split)**
  * *Problem:* Code inspectors and browser preview panes were initialized within a `ResizablePanelGroup`, squeezing the conversation pane down to a ~100px slit.
  * *Fix:* Panel wrappers on mobile screens are detached from the flex layout (`flex: 0 0 0px !important`), converting the panels into modal drawer overlays with hardware-accelerated slide-in transitions (`transform: translateX`), backdrop dimming, and explicit close buttons.

* **Sidebar drawer dismissal issues**
  * *Problem:* Sidebar auto-collapse only responded to active task ID mutations; tapping an already selected task left the drawer open. The open drawer covered the header button without providing a dedicated close trigger.
  * *Fix:* Drawer collapse is bound directly to navigation tap events (`collapseSidebarOnMobileNav`), and a dedicated close icon (`XIcon`) is added for touch viewports.

* **Viewport overscroll and unwanted input zooming in iOS**
  * *Problem:* iOS Safari rubber-band scrolling dragged the entire page off-screen, and inputs with font sizes below 16px triggered unwanted zoom on focus.
  * *Fix:* Set `overflow: hidden`, `overscroll-behavior: none`, and `touch-action: manipulation` at the `html, body` level. Input font size is locked to `16px !important`, viewport-fit is set to `cover`, and momentum scrolling (`-webkit-overflow-scrolling: touch`) is enabled with layer isolation.

* **Inaccessible message actions and tool call details on touch**
  * *Problem:* Copy and edit buttons required `:hover`, and tool call error details were trapped in hover-only tooltips.
  * *Fix:* Message action buttons are permanently visible on touch screens (`@media(hover:none)`). Error tooltips are replaced by interactive `Popover` components that toggle on tap.

---

### 3. Networking, Attachments & Notifications

* **Attachment upload failure over local HTTP**
  * *Problem:* Media upload required SHA-256 computation via WebCrypto (`crypto.subtle`), which modern browsers disable in non-secure HTTP environments (LAN HTTP, `http://192.168.x.x`). Uploads failed with `checksumUnavailable`. Clipboard copying broke similarly.
  * *Fix:* Added a pure JavaScript fallback for SHA-256 calculation and an `execCommand`-based clipboard polyfill.

* **Absence of background alerts without VPN**
  * *Problem:* Safari Web Push requires verified SSL certificates (unavailable on local IP addresses), and configuring VPN tunnels on mobile devices is inconvenient for quick tasks.
  * *Fix:* Integrated a native ntfy bridge. The server issues an HTTP POST to `ntfy.sh` upon task completion or error. Alerts arrive in the free ntfy mobile app even with locked screens and closed browsers.

---

### 4. Server Architecture, Session State & Localization

* **Session reset on PWA memory reclamation**
  * *Problem:* When mobile operating systems reclaim memory from background tabs, reopening the PWA triggered a cold start, clearing the active session reference and opening a blank draft.
  * *Fix:* Added `restoreOnFreshLoad: !isDesktop`, which restores the last active chat from local storage on startup.

* **Single-workspace limitation and lost default conversations**
  * *Problem:* The server accepted only one path in `ZCODE_SERVER_WORKSPACE`, locking out the default conversation workspace (`~/.zcode/workspace/default`). Windows 8.3 short paths caused libuv `fs-event` assertion crashes.
  * *Fix:* Enabled semicolon-separated multi-workspace paths (`dir1;dir2`), mapped default conversations as a dedicated project item, and normalized paths via `realpathSync.native`.

* **Model selection reset across projects**
  * *Problem:* Model choices were saved strictly per-workspace, causing switches between workspaces to reset to dead system defaults.
  * *Fix:* Added global tracking of the last selected model (`zcode-model-selection-recent-global-v1`).

* **MCP tool initialization race condition**
  * *Problem:* Slower stdio MCP servers failed to register before initial turn timeouts, locking the tool registry at 0 tools. The web settings panel rendered an empty server list.
  * *Fix:* Added `collectLateArrivals` for post-turn registration with tool cache invalidation. Connected the `mcpSyncService` RPC channel to the web client settings UI.

* **Russian localization**
  * *Problem:* Upstream supported only English and Chinese.
  * *Fix:* Full translation of 5,472 UI strings with standardized engineering terminology, added a quick language toggle in the sidebar, and registered `ru-RU` in server validation schemas.

---

## Comparison Summary

| Area | Original ZCode Web | ZCode Touch (This Fork) |
| :--- | :--- | :--- |
| **Typing Latency** | 1–2s WebKit freezes when editing words | ⚡ **Zero-lag typing**, debounced drafts, input fast-path |
| **Virtual Keyboard** | Automatically opens on page transitions | 📱 **Opens only on explicit tap** into the input field |
| **Panels** | Squeezes conversation pane to 100px | 🎨 **Drawer overlays** with background dimming |
| **iOS Scrolling** | Viewport displacement and focus zooming | 🧈 **Momentum scrolling**, locked viewport, 16px font |
| **Notifications** | Active tab required | 🔔 **ntfy.sh push alerts** over plain HTTP |
| **LAN Attachments** | `checksumUnavailable` error on HTTP | 📎 **Pure JS SHA-256 fallback**, stable uploads |
| **PWA Memory** | Resets to blank draft upon tab reload | 💾 **Session restoration** (`restoreOnFreshLoad`) |
| **Projects** | Single workspace only; conversations lost | 📁 **Multi-workspace** (`dir1;dir2`), 8.3 path fix |
| **Model Selection** | Resets to default when changing project | 🎯 **Sticky Model** globally across projects |
| **MCP Tools** | Registry stuck at 0 tools | 🔌 **collectLateArrivals** + working settings |
| **Languages** | English / 中文 only | 🌐 **100% Russian localization** (5,472 keys) |

---

## Quickstart

### Method 1: Prebuilt Package (Recommended)

```bash
curl -fsSL https://github.com/v9n9yphb67-ui/ZCode/releases/download/v3.14.0-web/install.sh | sh
```

Start the server:
```bash
zcode --web --host 0.0.0.0 --port 3040
```

Connect using the printed URL:
```
http://192.168.x.x:3040/?token=YOUR_TOKEN
```

### Method 2: Build from Source

```bash
git clone -b iphone-web https://github.com/v9n9yphb67-ui/ZCode.git
cd ZCode

pnpm install
pnpm --filter @zcode/server build
pnpm --filter @zcode/web build

PORT=3040 ZCODE_SERVER_HOST=0.0.0.0 node packages/server/dist/entry-http.js
```

### Add to Home Screen (PWA)

1. Open your server URL in **Safari on iOS** (or Chrome on Android).
2. Tap **Share** -> **Add to Home Screen**.
3. Launch ZCode Touch from the home screen icon.

---

## Security

* **Trusted Networks Only (LAN):** Designed for secure home Wi-Fi or private VPN setups.
* **Do not expose port 3040 to the public internet** without HTTPS encryption and an authenticated reverse proxy (Nginx, Caddy, Cloudflare Tunnel).
* Auth tokens reside in your browser's local storage.

---

## License

ZCode is originally developed by [zai-org/ZCode](https://github.com/zai-org/ZCode) and licensed under **Apache License 2.0**.
All original licenses (`LICENSE`), notices (`NOTICE.md`), and third-party notices are preserved.
