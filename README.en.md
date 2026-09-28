# ZCode Touch (Mobile Web & PWA)

<p align="center">
  <strong>Full-featured desktop ZCode on mobile screens: self-hosted without cloud dependencies, rock-solid scrolling, instant restoration, and Russian localization.</strong>
</p>

<p align="center">
  <a href="README.md">Русский</a> • <strong>English</strong> • <a href="README.upstream-zh.md">Original README (中文)</a> • <a href="README.upstream-en.md">Original Upstream (EN)</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platforms-iOS%20%7C%20Android-blue?style=flat-square" alt="Platforms" />
  <img src="https://img.shields.io/badge/PWA-Ready-success?style=flat-square" alt="PWA Ready" />
  <img src="https://img.shields.io/badge/i18n-Russian%20(100%25)-green?style=flat-square" alt="Russian" />
  <a href="https://t.me/AlexaLaRose" target="_blank"><img src="https://img.shields.io/badge/Telegram-@AlexaLaRose-2CA5E0?style=flat-square&logo=telegram&logoColor=white" alt="Telegram" /></a>
</p>

<p align="center">
  <a href="#why-this-project-exists">Why this project</a> •
  <a href="#key-highlights">Key Highlights</a> •
  <a href="#seamless-desktop-handoff-pc--phone">Desktop Handoff</a> •
  <a href="#additional-mobile-refinements">All Refinements</a> •
  <a href="#quickstart">Quickstart</a> •
  <a href="#remote-access-outside-home-network">Remote Access</a> •
  <a href="#security">Security</a>
</p>

---

## Why this project exists

Previously, remote phone usage relied on the official ZCode cloud relay (`zcode.z.ai`), which introduced painful real-world friction:
* Persistent cloud relay latency and slow reconnects requiring a pairing screen every time the PWA was backgrounded or reopened.
* Annoying scroll jumping and jitter during conversations, deteriorating as session history grew.
* A stripped-down interface compared to the PC app, packaged in a closed minified bundle that couldn't be customized or patched.

**In this project, the complete desktop ZCode codebase was decoupled from the cloud and adapted for mobile touchscreens.** Rather than a simplified companion, this brings the full power and informativeness of desktop ZCode into a self-hosted, touch-optimized mobile experience.

---

## Key Highlights

### 1. Self-Hosted Without ZCode Cloud
Direct local connection between your mobile device and your PC over home Wi-Fi (~1 ms latency):
* Complete independence from external `zcode.z.ai` relay infrastructure.
* Session restoration speed after backgrounding or OS memory reclaim increased dramatically: no more pairing screens, reconnection is instant over local WebSockets.

### 2. Rock-Solid Scrolling Without Jitter in Long Sessions
Completely eliminated scroll jumping and stuttering in long threads:
* Smooth scrolling even in massive conversations packed with tool calls.
* Hardware-accelerated iOS momentum scrolling (`-webkit-overflow-scrolling: touch`), row style isolation, and expanded virtual buffer.

### 3. Substantial Speed & Navigation Optimizations
* Eliminated typing lag and freezes when editing or backspacing text in Safari (debounced drafts, detached heavy re-renders).
* Fast session switching, menu opening, and project navigation.

### 4. Informative Desktop UI on Mobile Screens
Unlike watered-down mobile web views, full desktop capabilities are preserved:
* Complete task tree, detailed diffs, terminal outputs, tool statuses, and error inspectors.
* Heavy side panels open as smooth GPU-accelerated drawer overlays with background dimming instead of crushing the conversation pane.

### 5. 100% Russian Localization
* Full interface translation (5,472 strings) with standardized engineering terminology.
* Instant language toggle ("Ру") in the sidebar footer.

---

## Seamless Desktop Handoff (PC ↔ Phone)

The desktop `ZCode.exe` application and the local web server share **the exact same system data directory**: `~/.zcode` (on Windows: `C:\Users\<Username>\.zcode`).

* **If you already have ZCode installed on your PC:**  
  No migration, file copying, or re-configuration is needed. The web server automatically reads your existing models, API keys, memory, plugins, and session history.
* **If you are installing from scratch:**
  * *Web & Mobile PWA only:* The desktop `.exe` is not required — the `install.sh` package provides complete standalone functionality. On PC, open it in any browser or install it as a borderless Desktop PWA (via Chrome/Edge).
  * *With native ZCode.exe desktop app:* Install the official desktop application from the upstream vendor or build it from source (`pnpm dev:desktop`). The shared data directory is connected automatically.

---

## Additional Mobile Refinements

* 🔔 **Background alerts:** Server pushes an alert to your phone on task completion or failure. On a plain-HTTP LAN the ntfy bridge handles it (no VPN or SSL); over HTTPS (through the tunnel) native PWA Web Push additionally comes to life.
* ⌨️ **Smart keyboard focus:** The virtual keyboard opens *strictly upon tapping the input box*, not automatically on page loads or session switches.
* 📎 **Wi-Fi attachments:** Photos and files upload seamlessly over local HTTP via a pure JS SHA-256 fallback (bypassing HTTPS WebCrypto restrictions).
* 📁 **Multi-workspace support:** Server handles multiple project directories simultaneously (`dir1;dir2`), exposing default conversations cleanly.
* 🎯 **Sticky model preference:** Your chosen model and reasoning settings persist globally across projects.
* 🔒 **Viewport lock:** Eliminated iOS rubber-band dragging and accidental input zooming.
* 🔌 **Stable MCP initialization:** Resolves startup race condition for slower stdio MCP servers (`collectLateArrivals`).

---

## Quickstart

### One-Line Install (Recommended)

```bash
curl -fsSL https://github.com/v9n9yphb67-ui/ZCode/releases/download/v3.14.0-web/install.sh | sh
```

Start the server:
```bash
zcode --web --host 0.0.0.0 --port 3040
```

Access the server from your phone:
```
http://192.168.x.x:3040/?token=YOUR_TOKEN
```

### Add to Home Screen (PWA)

1. Open your server URL in **Safari on iOS** (or Chrome on Android).
2. Tap **Share** -> **Add to Home Screen**.
3. Launch ZCode Touch from the home screen icon as a standalone fullscreen app.

### Configuring Multi-Workspace (Multiple Project Folders)

The server supports running multiple project directories simultaneously by separating paths with a semicolon `;`:

```bash
# Via the --workspace flag:
zcode --web --host 0.0.0.0 --port 3040 --workspace "/path/to/project1;/path/to/project2"

# Or via the ZCODE_SERVER_WORKSPACE environment variable:
export ZCODE_SERVER_WORKSPACE="/path/to/project1;/path/to/project2"
zcode --web --host 0.0.0.0 --port 3040
```

All specified folders will be listed as separate project items in the mobile sidebar drawer, allowing you to switch between different codebases without restarting the server.

---

## Remote Access Outside Home Network

If you need to access ZCode Touch outside your home Wi-Fi (over mobile LTE/5G or while traveling), use the built-in **Cloudflare Tunnel** support:

```bash
zcode --web --tunnel
```

The server automatically generates a secure access token, starts `cloudflared`, and outputs the public URL:
```text
Tunnel:  https://xxxx.trycloudflare.com/?token=YOUR_TOKEN
```

### Advantages of Cloudflare Tunnel:
* **Keeps your mobile VPN slot free:** On iOS and Android, you can keep your primary VPN connected — the tunnel routes over standard HTTPS.
* **No public IP or port forwarding required:** Works behind CGNAT and firewalls via outbound edge connections.
* **Native Web Push enabled:** Secure HTTPS automatically enables the built-in PWA Web Push toggle under "Settings → Notifications" (in addition to the ntfy bridge for plain HTTP LAN).
* **Custom domain support (optional):** If you run a permanent named tunnel on Cloudflare Zero Trust, pass your token via `--tunnel-token <TOKEN>` or the `CLOUDFLARE_TUNNEL_TOKEN` environment variable.

> Requires [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) installed on your host PC (`winget install Cloudflare.cloudflared` on Windows or `brew install cloudflared` on macOS).

---

## Security

* Access to the server is always gated by the secret token embedded in the connection link.
* For use away from home, use the built-in `--tunnel` mode (see [Remote Access](#remote-access-outside-home-network)): Cloudflare Tunnel opens no router ports (the connection is outbound), provides HTTPS, and forces the token on. Optionally, you can further gate access behind Cloudflare Zero Trust auth.
* Do not expose a bare port 3040 to the public internet without HTTPS and a token — external access is meant to go through the tunnel or a TLS reverse proxy.

---

## License

Originally created by [zai-org/ZCode](https://github.com/zai-org/ZCode) and licensed under **Apache License 2.0**.
All original licenses (`LICENSE`), notices (`NOTICE.md`), and third-party attributions are preserved.

---

> **P.S.** Sorry for the AI-generated text, couldn't be bothered to format all of this manually, thanks everyone.
