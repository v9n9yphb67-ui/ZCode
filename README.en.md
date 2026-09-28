# ZCode Touch (Mobile Web & PWA)

<p align="center">
  <strong>ZCode adapted for smartphones and tablets: lag-free touch typing, native PWA layout, background notifications without VPN, and full Russian localization.</strong>
</p>

<p align="center">
  <a href="README.md">Русский</a> • <strong>English</strong> • <a href="README.upstream-zh.md">Original README (中文)</a> • <a href="README.upstream-en.md">Original Upstream (EN)</a>
</p>

<p align="center">
  <a href="#why-this-fork-real-complaints--how-they-were-fixed">Why this fork (Complaints & Fixes)</a> •
  <a href="#feature-comparison-summary">Comparison</a> •
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

## Why this fork: real complaints & how they were fixed

The original ZCode web client (`zcode --web`) was designed as a direct port of the Electron desktop application, intended for a mouse and an external monitor. When trying to actually use it on a mobile device (an iPhone running standalone PWA over local home Wi-Fi), a cascade of blocking issues made mobile development unusable.

Here are the **real complaints and pain points** experienced during day-to-day phone usage, and how each one was addressed in this fork:

---

### 1. Typing & Virtual Keyboard

#### 🔴 Complaint: *"Typing stutters and freezes whenever I try to edit or backspace a partially typed word"*
* **What went wrong in upstream:** On every single keystroke or backspace, the composer synchronously called `updateComposerContent` -> updated parent state -> re-rendered the **entire session pane** (4,000+ lines of React code). Additionally, the input plugin scanned the entire DOM tree via `getAllTextNodes()` on every `beforeinput` event in WebKit, while `TextContentPlugin` ran duplicate Markdown AST serializations. In mobile Safari, editing or erasing text froze the UI thread for 1–2 seconds.
* **⚡ How it was fixed:**
  1. Draft persistence was decoupled from frame rendering: text saving is now debounced (350ms).
  2. The send-button status only updates when transitioning `empty ↔ non-empty`, never triggering parent re-renders while typing body text.
  3. Added an input event fast-path guard: heavy DOM tree traversals are skipped for normal letter input, and a guard skips processing during IME/word composition (`editor.isComposing()`).
  4. Cached `lastReportedTextRef` to eliminate redundant AST serializations. Typing and editing on Safari is now buttery smooth.

#### 🔴 Complaint: *"The keyboard forcibly pops up on every page load, covering half the screen"*
* **What went wrong in upstream:** In the composer focus controller, the mobile viewport flag was hardcoded to `isMobileViewport: false`. On every component mount, tab switch, or new task creation, desktop `inputApi.focus()` was called. On iOS, the virtual keyboard automatically popped open and covered the screen, requiring manual dismissal every single time.
* **📱 How it was fixed:** Implemented coarse-touch device detection (`isMobileTouchViewport` for touch viewports ≤767px). Autofocus during cold starts and tab transitions safely returns `"skip"`. The keyboard now appears **only when you explicitly tap into the input box**.

---

### 2. Touch UI & Responsive Layout

#### 🔴 Complaint: *"The right side pane splits the screen 50/50, squishing the chat into an unreadable 100px sliver"*
* **What went wrong in upstream:** The code/preview/browser inspector was part of a desktop `ResizablePanelGroup`. Opening it recalculated `flex-grow` on adjacent panels, crushing the chat down to an unreadable 100px slit.
* **🎨 How it was fixed:** The outer panel wrapper was decoupled from the flex flow on mobile screens (`[data-panel]#browser { flex: 0 0 0px !important }`), and the inner inspector was rewritten as a modal drawer overlay (`w-[min(92vw,560px)]`) featuring GPU-accelerated slide-in animation (`transform: translateX`), a dimmed backdrop, and a close button. The conversation behind it always stays at 100% width.

#### 🔴 Complaint: *"The sidebar drawer doesn't auto-close on selection, and there is no close button"*
* **What went wrong in upstream:** Sidebar auto-collapse was bound to changes in `activeTaskId`. Tapping the currently active task failed to trigger closing. Furthermore, the opened sidebar covered the hamburger button without offering a close icon.
* **🚪 How it was fixed:** Drawer collapse was bound directly to the tap action on any navigation item (`collapseSidebarOnMobileNav`), and an explicit close icon (`XIcon`) was added to the top right of the drawer on touch devices.

#### 🔴 Complaint: *"Scrolling the chat drags the entire window off-screen, and inputs trigger unwanted page zooming"*
* **What went wrong in upstream:** In iOS Safari, the native rubber-band bounce dragged the entire HTML document off-screen while scrolling. Inputs with font sizes smaller than 16px forced Safari to zoom the entire page upon focus.
* **🧈 How it was fixed:**
  1. `html, body` styles locked down with `overflow: hidden`, `touch-action: manipulation`, and `overscroll-behavior: none` — only the inner message stream scrolls.
  2. Input font sizes on screens ≤767px are locked to `16px !important`, with `viewport-fit=cover`.
  3. The conversation timeline (`ConversationTimeline`) uses hardware-accelerated momentum scrolling (`-webkit-overflow-scrolling: touch`), style isolation (`will-change: transform`, `contain: layout style`), and an expanded 12-row overscan buffer.

#### 🔴 Complaint: *"Message action buttons (copy/edit) and tool error details cannot be opened by tap"*
* **What went wrong in upstream:** Message action buttons were hidden behind `group-hover:opacity-100` (touch screens lack hover). Tool call error descriptions lived exclusively in Radix UI tooltips that only opened on mouse hover.
* **👆 How it was fixed:** Message actions are always visible on devices without pointers (`@media(hover:none)`). Error tooltips were converted to interactive `Popover` components that toggle on tap.

---

### 3. Networking, Attachments & Notifications

#### 🔴 Complaint: *"Uploading photos from the phone fails immediately with an '!' error badge"*
* **What went wrong in upstream:** The attachment transaction required SHA-256 computation via WebCrypto API (`crypto.subtle.digest`). Web standards disable WebCrypto in non-secure HTTP contexts. When connecting over local Wi-Fi (`http://192.168.x.x:3040`), browsers disable `crypto.subtle`, throwing `fault.attachment.checksumUnavailable` before upload even began. Clipboard copy (`navigator.clipboard`) broke for the same reason.
* **📎 How it was fixed:** Implemented a pure JavaScript SHA-256 fallback algorithm that works in any context. Added a clipboard polyfill based on `document.execCommand('copy')`. Photo and file attachments now upload reliably over standard LAN HTTP.

#### 🔴 Complaint: *"Sitting and staring at the screen waiting for agent tasks is frustrating, and Tailscale had to be removed due to iOS single-VPN limits"*
* **What went wrong in upstream:** iOS only permits one active VPN slot (needed for personal use, ruling out Tailscale). Browser Web Push in Safari strictly demands verified HTTPS certificates, which cannot be issued for raw local IPs.
* **🔔 How it was fixed:** Integrated a native **ntfy.sh bridge**. The server performs a direct HTTP POST to `https://ntfy.sh/<secret_topic>` upon task completion or error (triggered by `background_terminal`). Using the free **ntfy** app on iOS / Android, you receive sound and push notifications even with your phone locked and the browser closed — zero VPN, zero SSL certificates.

---

### 4. Server Architecture, Session Persistence & i18n

#### 🔴 Complaint: *"When iOS clears background tabs from memory, the PWA resets to an empty draft"*
* **What went wrong in upstream:** Session persistence (`usePaneSessionPersistence`) only restored state on page `reload`. When iOS discarded a background PWA tab, reopening was treated as `navigate` (cold start). Upstream code explicitly forced a blank draft and erased the last-session key.
* **💾 How it was fixed:** Added `restoreOnFreshLoad: !isDesktop`. On mobile, any cold start reads `localStorage` and immediately restores the last active chat session.

#### 🔴 Complaint: *"Creating a new task with '+' creates it in the project instead of conversations, and the default workspace cannot be opened"*
* **What went wrong in upstream:** The web server only accepted a single path in `ZCODE_SERVER_WORKSPACE`. The conversation workspace (`~/.zcode/workspace/default`) was not reported to the web client, and the conversation list depended on the desktop-only `windowControllerService`.
* **📁 How it was fixed:**
  1. `ZCODE_SERVER_WORKSPACE` now accepts semicolon-separated paths (`dir1;dir2`).
  2. The conversation workspace is rendered in the sidebar as a project row ("Задачи").
  3. Server paths are normalized via `realpathSync.native`, resolving Windows 8.3 short paths (`ADCC~1`) that caused libuv `fs-event` crashes.

#### 🔴 Complaint: *"The model selection keeps resetting to a dead default when switching projects"*
* **What went wrong in upstream:** Model preferences were saved strictly per-workspace. Navigating to conversations found no record and defaulted to a non-functional system preset.
* **🎯 How it was fixed:** Added a global recent model store (`zcode-model-selection-recent-global-v1`). Any model or reasoning effort chosen in the selector is immediately preserved across all workspaces and drafts.

#### 🔴 Complaint: *"Agents cannot see MCP tools in the web version, and the server list in settings is blank"*
* **What went wrong in upstream:**
  1. On session start, stdio MCP servers (gce, exa) take 3–5 seconds to initialize. If the agent initialized earlier, the runtime set `mcpToolsRegistered = true` with 0 tools, permanently ignoring them.
  2. `resolveMcpDirectoryService` returned a stub with an empty server list for local web workspaces.
* **🔌 How it was fixed:** Added `collectLateArrivals` to the agent runtime, registering newly ready tools on subsequent turns and busting the tool cache. Linked `mcpSyncService` RPC in the web client, displaying toggle switches correctly in settings.

#### 🔴 Complaint: *"We need full, proper Russian localization without broken layouts or cut-off text"*
* **What went wrong in upstream:** Upstream only supported English and Chinese. Machine translation tools caused severe layout overflows and inconsistent terminology.
* **🌐 How it was fixed:** Complete professional translation of all 5,472 UI strings via Claude Opus using a unified engineering glossary. Added an instant language toggle ("Ру") in the sidebar footer and updated server validation schemas to accept `ru-RU`.

---

## Feature Comparison Summary

| Area | Original ZCode Web | ZCode Touch (This Fork) |
| :--- | :--- | :--- |
| **Typing on iPhone** | WebKit freezes for 1–2s when editing a word | ⚡ **Zero-lag typing**, debounced drafts, input fast-path |
| **Virtual keyboard** | Forcibly pops up on every page transition | 📱 **Opens only on explicit tap** into the input field |
| **Side panels** | Crushes the chat 50/50 into a 100px slit | 🎨 **Smooth drawer overlays** with backdrops & close buttons |
| **iOS scrolling** | Screen rubber-banding & unwanted zoom | 🧈 **Momentum scrolling**, locked viewport, 16px font |
| **Notifications** | Only works while the browser tab stays open | 🔔 **ntfy.sh push notifications** over plain HTTP (no VPN) |
| **Attachments over Wi-Fi** | Fails with `checksumUnavailable` on HTTP | 📎 **Pure JS SHA-256 fallback**, reliable uploads |
| **PWA memory discard** | Resets to an empty draft upon memory reclaim | 💾 **Automatic session restoration** (`restoreOnFreshLoad`) |
| **Projects** | Single workspace only; conversations lost | 📁 **Multi-workspace** (`dir1;dir2`), Windows 8.3 path normalization |
| **Model selection** | Resets to default when changing projects | 🎯 **Sticky Model** globally across all workspaces |
| **MCP tools** | "0 tools" due to initialization race condition | 🔌 **collectLateArrivals** + working MCP settings |
| **Languages** | English / 中文 only | 🌐 **100% Russian localization** (5,472 keys) + language switcher |

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

### Adding to Home Screen (PWA on iOS / Android)

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
