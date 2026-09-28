/* eslint-disable max-lines -- Web 入口集中编排启动、路由与 workspace shell wiring，与 Root.tsx 同样先保持入口收口，避免跨层状态拆散。 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppErrorBoundary,
  Root,
  ZCodeIntlProvider,
  generateMobileDeviceFingerprint,
  playTaskNotificationSound,
  registerPushServiceWorker,
  setStreamClientId,
  type Theme,
} from "@zcode/ui";
import "@zcode/ui/styles.css";
import { connectViaWebSocket } from "@zcode/client";
import { WebCallbackPage } from "./auth/WebCallbackPage.js";
import { createWebAuthService } from "./auth/webAuthService.js";
import { WEB_ZAI_OAUTH_CONFIG, resolveWebAuthDevReturnTo } from "./auth/webZaiOAuthConfig.js";
import { parseOAuthState, resolveSafeAppReturnTo } from "./auth/oauthStateCodec.js";
import { resolveWebCommunityUrl, resolveWebHelpConfig } from "./communityUrl.js";
import {
  ConversationShareLandingLoader,
  ConversationShareLandingStatus,
} from "./share/ConversationShareLandingPage.js";
import {
  ConversationSharePreviewClient,
  resolveConversationShareRouteLocale,
} from "./share/conversationSharePreviewClient.js";
import {
  isConversationSharePath,
  resolveConversationShareCodeFromPath,
} from "./share/conversationShareRoute.js";
import type { IPlatformService, RemoteTarget, ServerRemoteInfo } from "@zcode/shared";
import { WEB_DEFAULT_THEME, resolveWebInitialTheme } from "./webThemeSeed.js";

// На http:// (LAN) iOS Safari и часть Android Chrome отключают navigator.clipboard в небезопасном
// контексте → кнопки копирования молча падают. Полифилл: если Clipboard API нет, writeText идёт
// через execCommand('copy') (работает внутри пользовательского жеста — как раз клик по «копировать»).
(() => {
  if (typeof navigator === "undefined" || typeof document === "undefined") return;
  const nav = navigator as Navigator & { clipboard?: { writeText?: (t: string) => Promise<void> } };
  if (nav.clipboard && typeof nav.clipboard.writeText === "function") return;
  const writeText = (text: string): Promise<void> => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok ? Promise.resolve() : Promise.reject(new Error("execCommand copy failed"));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  };
  try {
    if (!nav.clipboard) {
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    } else {
      nav.clipboard.writeText = writeText;
    }
  } catch {
    /* браузер запретил переопределение — оставляем как есть */
  }
})();

function resolveWebThemePreference(defaultTheme: Theme = WEB_DEFAULT_THEME): Theme {
  try {
    const themeFromUrl = new URLSearchParams(window.location.search).get("theme");
    if (
      themeFromUrl === "zai-dark" ||
      themeFromUrl === "zai-light" ||
      themeFromUrl === "dark" ||
      themeFromUrl === "light" ||
      themeFromUrl === "system"
    ) {
      localStorage.setItem("zcode-theme", themeFromUrl);
      return resolveWebInitialTheme({ storedTheme: themeFromUrl, defaultTheme });
    }
  } catch {
    /* ignore URL theme override errors */
  }
  const saved = localStorage.getItem("zcode-theme");
  return resolveWebInitialTheme({ storedTheme: saved, defaultTheme });
}

// 初始化主题：默认 Zai dark，后续由 useTheme hook 接管
// system 模式下需要查询系统偏好；非 system 模式直接用存储值
{
  // 分享页没有本地主题配置时使用浅色，已有配置仍然沿用；其他 Web 页面继续默认深色。
  const saved = resolveWebThemePreference(
    isConversationSharePath(window.location.pathname) ? "zai-light" : undefined,
  );
  const resolved =
    saved === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : saved === "dark" || saved === "zai-dark"
        ? "dark"
        : "light";
  const appliedTheme =
    saved === "system"
      ? resolved === "dark"
        ? "zai-dark"
        : "zai-light"
      : saved === "dark"
        ? "zai-dark"
        : saved === "light"
          ? "zai-light"
          : saved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("theme-zai-light", appliedTheme === "zai-light");
  document.documentElement.classList.toggle("theme-zai-dark", appliedTheme === "zai-dark");
}

async function resolveFeedbackUrl(): Promise<string | undefined> {
  return (await resolveWebHelpConfig()).feedback_url;
}

const root = createRoot(document.getElementById("root")!);
const webAuthService = createWebAuthService();

// 初始化 Web 端流式 clientId，确保所有 hook 在首次渲染前就使用稳定 ID
{
  setStreamClientId(generateMobileDeviceFingerprint());
}

interface WebBootstrapResult {
  wsUrl: string;
  initialWorkspaceAbsPath?: string;
  initialWorkspaceIdentity?: string;
  /** Все рабочие пространства сервера (мульти-workspace): добавляются вкладками при старте. */
  initialWorkspaces?: Array<{ workspacePath: string; workspaceIdentity?: string }>;
  initialTaskId?: string;
  restoreSession?: boolean;
  allowOpenWorkspace?: boolean;
}

function isWebOAuthCallback(params: URLSearchParams): boolean {
  return (
    ["/cn/share/callback", "/share/callback"].includes(window.location.pathname) &&
    params.has("state") &&
    (params.has("code") || params.has("error"))
  );
}

function renderWebAuthCallbackPage(): void {
  document.title = "ZCode - Sign In";
  const callbackState = parseOAuthState(
    new URLSearchParams(window.location.search).get("state") ?? "",
  );
  const safeRetryTarget = resolveSafeAppReturnTo(callbackState?.app_return_to);
  root.render(
    <WebCallbackPage
      authService={webAuthService}
      onSuccess={({ appReturnTo }) => {
        window.location.replace(appReturnTo ?? "/");
      }}
      onRetry={() => {
        window.location.replace(safeRetryTarget ?? "/");
      }}
    />,
  );
}

async function renderConversationSharePage(): Promise<void> {
  // 页面语言跟随路径前缀：/cn/share 中文，裸 /share 英文。
  const routeLocale = resolveConversationShareRouteLocale(window.location.pathname);
  // index.html 固定 lang="en"；不同步会让中文分享页对无障碍与浏览器翻译都报错语言。
  document.documentElement.lang = routeLocale;
  // 分享页必须设置 title：否则浏览器标签只显示 index.html 的通用标题。
  // 会话标题要等 preview 加载完，先给一个语言正确的兜底。
  document.title = routeLocale === "zh-CN" ? "ZCode 会话分享" : "ZCode Conversation Share";
  const shareCode = resolveConversationShareCodeFromPath(window.location.pathname);
  if (!shareCode) {
    root.render(
      <ConversationShareLandingStatus
        state={{ kind: "error", error: "invalid_contract" }}
        locale={routeLocale}
      />,
    );
    return;
  }

  const endpointOrigin =
    import.meta.env.VITE_ZCODE_BASE_URL?.trim().replace(/\/+$/u, "") || window.location.origin;
  const mockMode =
    import.meta.env.DEV && import.meta.env.VITE_CONVERSATION_SHARE_PREVIEW_MOCK === "true";
  // Share 加载失败不能只有通用 network 文案：需要区分 mock、endpoint 配置或跨域 fetch。
  // 这里只记录运行时路由与 endpoint，不记录完整 pathname，避免把 share code 写入日志。
  console.info("[conversation-share-web]", "preview_runtime_initialized", {
    browserOrigin: window.location.origin,
    routeKind: "canonical",
    endpointOrigin,
    transport: mockMode ? "mock" : "fetch",
  });
  const client = mockMode
    ? new (
        await import("./share/mockConversationSharePreviewClient.js")
      ).MockConversationSharePreviewClient()
    : new ConversationSharePreviewClient({ baseUrl: `${endpointOrigin}/api/v1` });
  const getMockToken = () =>
    mockMode && window.sessionStorage.getItem("zcode:share:mock-auth") === "owner"
      ? "mock-owner-token"
      : null;
  const onLogout = () => {
    if (mockMode) {
      window.sessionStorage.removeItem("zcode:share:mock-auth");
      window.location.reload();
      return;
    }
    void webAuthService.logout();
  };
  root.render(
    <ConversationShareLandingLoader
      shareCode={shareCode}
      client={client}
      getAccessToken={() => getMockToken() ?? webAuthService.getZCodeJwtToken()}
      onLogin={(provider) => {
        if (mockMode) {
          window.sessionStorage.setItem("zcode:share:mock-auth", "owner");
          window.location.reload();
          return;
        }
        webAuthService.startLogin({
          provider,
          appReturnTo: window.location.href,
          redirectUri: WEB_ZAI_OAUTH_CONFIG.shareRedirectUri,
          devReturnTo: resolveWebAuthDevReturnTo(WEB_ZAI_OAUTH_CONFIG),
        });
      }}
      onLogout={onLogout}
      locale={routeLocale}
      theme={resolveWebThemePreference("zai-light")}
    />,
  );
}

function createWebPlatform(): IPlatformService {
  return {
    canSelectFilePath: false,
    // Web 端无法打开系统目录选择框
    selectDirectory: () => Promise.resolve(null),
    // Web 端无法打开系统文件选择框
    selectFile: () => Promise.resolve(null),
    selectFiles: () => Promise.resolve([]),
    getPathForFile: () => null,
    createTempTextAttachment: () =>
      Promise.reject(new Error("Temporary text attachments require a desktop host")),
    onRemoteConnectionLog: () => () => {},
    onRemoteSessionClosed: () => () => {},
    // Web 端无多窗口管理
    activateOrSetWorkspace: () => Promise.resolve({ activated: false }),
    // TODO(web-remote-workspace): 普通 Web 模式先只保证 server 本地工作区可用。
    // 远程 WebSocket 只暴露部分 service，与 Root/RemoteServiceAccess 需要的完整
    // accessor 不匹配，直接打开 ?remote=<id> 会在项目向导或首屏卡住。
    connectRemote(options: RemoteTarget) {
      return Promise.resolve({
        success: false,
        error: `Remote connect is not supported in Web mode yet: ${options.kind}`,
      });
    },
    cancelPendingRemoteConnection: (_requestId?: string) => Promise.resolve(),
    disposeRemoteSession: () => Promise.resolve(),
    isDockerAvailable: () => Promise.resolve(false),
    listWSLDistros: () => Promise.resolve([]),
    listDockerContainers: () => Promise.resolve([]),
    listSSHConfigAliases: () => Promise.resolve([]),
    loadMcpFromUserDirectory: () => Promise.resolve({ servers: [] }),
    saveMcpToUserDirectory: () =>
      Promise.resolve({
        success: false,
        error: "MCP native directory management requires a desktop attachment",
      }),
    migrateLegacyCommonMcp: () =>
      Promise.resolve({
        servers: {},
        totalCount: 0,
        importedCount: 0,
        skippedCount: 0,
      }),
    openExternal: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    openFeedback: async () => {
      const feedbackUrl = await resolveFeedbackUrl();
      if (!feedbackUrl) {
        return;
      }
      window.open(feedbackUrl, "_blank", "noopener,noreferrer");
    },
    openCommunity: async () => {
      const locale = document.documentElement.lang === "en-US" ? "en-US" : "zh-CN";
      const communityUrl = await resolveWebCommunityUrl(locale);
      if (!communityUrl) {
        return;
      }
      window.open(communityUrl, "_blank", "noopener,noreferrer");
    },
    canOpenCommunity: async (locale) => {
      const communityUrl = await resolveWebCommunityUrl(locale);
      return typeof communityUrl === "string" && communityUrl.length > 0;
    },
    openInFileManager: () =>
      Promise.resolve({ success: false, error: "Not supported in web mode" }),
    openExternalFile: () => Promise.resolve({ success: false, error: "Not supported in web mode" }),
    registerOAuthState: (_payload) => {},
    onOAuthCallback: () => () => {},
    onPaymentCallback: () => () => {},
    onShareImport: () => () => {},
    notifyRendererReady: () => {},
    reportTelemetryEvent: async () => {},
    reportArmsCustomEvent: () => Promise.resolve(),
    showTaskNotification: (payload) => {
      if (document.hasFocus()) {
        return;
      }

      if (
        typeof window.Notification === "undefined" ||
        window.Notification.permission !== "granted"
      ) {
        return;
      }

      // Одинаковый tag с серверным пушем => если задача завершилась при закрытом окне,
      // серверный пуш и этот foreground-путь схлопнутся в одно уведомление, не задвоятся.
      const options: NotificationOptions = {
        body: payload.body,
        tag: `zcode-task:${payload.taskId}:${payload.status}`,
        silent: true,
      };

      void (async () => {
        try {
          // На мобильных PWA конструктор `new Notification` кидает исключение — уведомление
          // можно показать только через активный service worker. На desktop-браузере SW
          // может отсутствовать, тогда используем конструктор.
          const registration =
            "serviceWorker" in navigator
              ? await navigator.serviceWorker.getRegistration()
              : undefined;
          if (registration) {
            await registration.showNotification(payload.title, options);
          } else {
            new window.Notification(payload.title, options);
          }
          void playTaskNotificationSound();
        } catch {
          // 浏览器通知不可用时静默忽略，避免打断主流程
        }
      })();
    },
    // Web 端不需要跨窗口 tab 管理
    syncWindowTabs: () => {},
    // Web 端没有宿主层 Dock / 任务栏徽标，保持空实现以兼容统一平台接口
    syncWindowUnreadCount: () => {},
    syncActiveTaskSession: () => {},
    onFocusTab: () => () => {},
    onNewTab: () => () => {},
    onCloseActiveContextRequest: () => () => {},
    onOpenBrowserUrl: () => () => {},
    onNewTask: () => () => {},
    onOpenWorkspace: () => () => {},
    onWindowFullscreenChanged: () => () => {},
    onTaskNotificationClick: () => () => {},
    exportLogs: () => Promise.resolve({ success: false, error: "Not supported in web mode" }),
    captureWindowScreenshot: () => Promise.resolve(null),
    importChromeBrowserData: (_options) =>
      Promise.resolve({
        success: false,
        cookies: { imported: 0, skipped: 0, failed: 0 },
        localStorage: {
          originsImported: 0,
          entriesImported: 0,
          originsSkipped: 0,
          originsFailed: 0,
        },
        error: "chrome_import_not_supported" as const,
      }),
    clearEmbeddedBrowserData: () =>
      Promise.resolve({ success: false, error: "Not supported in web mode" }),
    // IPlatformService 新增更新提示能力后，Web fallback 没有同步补齐空实现，
    // 根级 typecheck 会直接失败，连与桌面端无关的改动都没法完成校验。
    // Web 端当前没有桌面更新器，先显式 no-op，保持接口完整且不改变现有行为。
    onUpdateReady: () => () => {},
    onUpdateCheckResult: () => () => {},
    onUpdateStateChanged: () => () => {},
    getUpdateState: () => Promise.resolve({ kind: "idle", enabled: true }),
    downloadUpdate: () => Promise.resolve(),
    cancelUpdateDownload: () => Promise.resolve(),
    getDesktopSessionActivity: () => Promise.resolve({ runningAgentSessionCount: 0 }),
    getDesktopZoomLevel: () => Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: () => () => {},
    onPostUpdateReleaseNotes: () => () => {},
    acknowledgePostUpdateReleaseNotes: () => Promise.resolve(),
    skipUpdateVersion: () => Promise.resolve(),
    quitAndInstallUpdate: () => Promise.resolve(),
    getInstalledEditors: () => Promise.resolve([]),
    openInEditor: () => Promise.resolve({ success: false, error: "Not supported in web mode" }),
    executeDesktopCommand: () => Promise.resolve(),
    setApplicationLocale: (_locale) => Promise.resolve(),
    setTitleBarTheme: () => Promise.resolve(),
    getDeviceId: () => {
      const nav = globalThis.navigator as Navigator & { platform?: string };
      const platform = nav?.platform ?? "";
      const screenWidth = globalThis.screen?.width;
      const screenHeight = globalThis.screen?.height;
      const colorDepth = globalThis.screen?.colorDepth;
      const parts = [
        platform,
        screenWidth !== undefined ? String(screenWidth) : "",
        screenHeight !== undefined ? String(screenHeight) : "",
        colorDepth !== undefined ? String(colorDepth) : "",
      ];
      return parts.filter(Boolean).join("|");
    },
  };
}

const LITE_TOKEN_STORAGE_KEY = "zcode_lite_token";

function resolveLiteAuthToken(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("token")?.trim();
    if (tokenFromUrl) {
      localStorage.setItem(LITE_TOKEN_STORAGE_KEY, tokenFromUrl);
      return tokenFromUrl;
    }
    return localStorage.getItem(LITE_TOKEN_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function appendTokenToUrl(url: string, token: string | null): string {
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

function resolveDefaultWsOrigin(): string {
  return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
}

async function resolveWebBootstrap(): Promise<WebBootstrapResult> {
  const token = resolveLiteAuthToken();
  const params = new URLSearchParams(window.location.search);
  const remoteId = params.get("remote");
  const rawWsUrl = remoteId
    ? `${resolveDefaultWsOrigin()}/ws/remote/${remoteId}`
    : `${resolveDefaultWsOrigin()}/ws`;
  const wsUrl = appendTokenToUrl(rawWsUrl, token);

  if (remoteId) {
    return { wsUrl };
  }

  try {
    const serverInfoUrl = appendTokenToUrl("/api/server-info", token);
    const response = await fetch(serverInfoUrl, {
      cache: "no-store",
    });
    if (!response.ok) {
      return { wsUrl };
    }
    const serverInfo = (await response.json()) as Partial<ServerRemoteInfo>;
    const workspaces = Array.isArray(serverInfo.workspaces) ? serverInfo.workspaces : [];
    const workspace = workspaces[0];
    // Мульти-workspace: первый = активная вкладка, остальные добавляются вкладками при старте.
    const initialWorkspaces = workspaces
      .filter((entry) => Boolean(entry?.path))
      .map((entry) => ({
        workspacePath: entry.path,
        ...(entry.workspaceIdentity ? { workspaceIdentity: entry.workspaceIdentity } : {}),
      }));
    return {
      wsUrl,
      ...(workspace?.path ? { initialWorkspaceAbsPath: workspace.path } : {}),
      ...(workspace?.workspaceIdentity
        ? { initialWorkspaceIdentity: workspace.workspaceIdentity }
        : {}),
      ...(initialWorkspaces.length > 0 ? { initialWorkspaces } : {}),
    };
  } catch {
    return { wsUrl };
  }
}

function WebBootstrapErrorScreen({ message }: { message: string }) {
  const [tokenInput, setTokenInput] = useState(() => resolveLiteAuthToken() ?? "");
  const isRussian = /^ru\b/i.test(navigator.language);
  const isChinese = /^zh\b/i.test(navigator.language);

  return (
    <div className="h-dvh min-h-dvh w-screen bg-background text-foreground">
      <div className="mx-auto flex h-full w-full max-w-lg items-center px-4">
        <section className="w-full rounded-xl border border-card-border bg-card p-5">
          <div className="flex items-center gap-3">
            <span className="size-2 rounded-full bg-destructive" />
            <h1 className="text-ui-xs font-medium">
              {isRussian
                ? "Ошибка запуска веб-клиента"
                : isChinese
                  ? "Web 启动失败"
                  : "Web bootstrap failed"}
            </h1>
          </div>
          <p className="mt-2 break-all text-ui-xs/relaxed text-foreground-subtle">{message}</p>
          <div className="mt-4 flex flex-col gap-2">
            <input
              type="text"
              placeholder={isRussian ? "Токен авторизации (token=...)" : "Auth token (token=...)"}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-ui-xs text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-1 focus:ring-border-active"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-ui-xs font-medium text-foreground hover:bg-surface-hover"
                onClick={() => {
                  const cleaned = tokenInput.trim();
                  if (cleaned) {
                    try {
                      localStorage.setItem(LITE_TOKEN_STORAGE_KEY, cleaned);
                    } catch {}
                    const u = new URL(window.location.href);
                    u.searchParams.set("token", cleaned);
                    window.location.href = u.toString();
                    return;
                  }
                  window.location.reload();
                }}
              >
                {isRussian ? "Подключить" : isChinese ? "重试" : "Connect"}
              </button>
              <button
                type="button"
                className="rounded-lg border border-border bg-surface px-3 py-2 text-ui-xs text-foreground-subtle hover:bg-surface-hover"
                onClick={() => {
                  window.location.reload();
                }}
              >
                {isRussian ? "Обновить" : "Reload"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function renderWebBootstrapError(error: unknown): void {
  document.title = "ZCode - Web";
  root.render(
    <WebBootstrapErrorScreen message={error instanceof Error ? error.message : String(error)} />,
  );
}

// ZCode Remote：此前 Web 端只在启动时 connectViaWebSocket 一次、onClose 为空，iOS 挂起标签页后
// 底层 socket 被断开却无人重连，回前台只能整页刷新（冷启动重渲染长历史 + 滚动跳动）。这里补一个
// 软重连：可见性/在线/bfcache 恢复时若 socket 已死，则重连并以 appConnectionEpoch 作为 Root 的 key
// 重挂，复用 web-remote-replayable 恢复链路（会话 store 的 base 游标），避免整页导航的资源二次下载与白屏。
let appConnectionEpoch = 0;
let liveSocket: WebSocket | null = null;
let reconnectInFlight = false;
let reconnectPending = false;
let autoReconnectEnabled = false;

function isLiveSocketOpen(): boolean {
  return liveSocket !== null && liveSocket.readyState === WebSocket.OPEN;
}

async function connectAndRenderApp(bootstrap: WebBootstrapResult): Promise<void> {
  const services = await connectViaWebSocket(bootstrap.wsUrl, {
    onOpenSocket: (ws) => {
      liveSocket = ws;
    },
    onClose: () => {
      if (!autoReconnectEnabled) {
        return;
      }
      // 标记需要重连；后台无法建连，等回到前台由可见性事件消费。
      reconnectPending = true;
      if (document.visibilityState === "visible") {
        void scheduleReconnect(bootstrap);
      }
    },
  });
  const platform = createWebPlatform();
  document.title = "ZCode - Web + Server";

  root.render(
    <AppErrorBoundary>
      <ZCodeIntlProvider
        settingService={services.settingService}
        broadcastService={services.broadcastService}
      >
        <Root
          key={appConnectionEpoch}
          services={services}
          platform={platform}
          initialWorkspaceAbsPath={bootstrap.initialWorkspaceAbsPath}
          initialWorkspaceIdentity={bootstrap.initialWorkspaceIdentity}
          initialWorkspaces={bootstrap.initialWorkspaces}
          initialTaskId={bootstrap.initialTaskId}
          restoreSession={bootstrap.restoreSession}
          allowOpenWorkspace={bootstrap.allowOpenWorkspace}
          preferDirectoryBrowser
          supportsEmbeddedBrowser={false}
          allowRemoteWorkspace={false}
        />
      </ZCodeIntlProvider>
    </AppErrorBoundary>,
  );
}

async function scheduleReconnect(bootstrap: WebBootstrapResult): Promise<void> {
  if (!autoReconnectEnabled || reconnectInFlight || isLiveSocketOpen()) {
    return;
  }
  reconnectInFlight = true;
  reconnectPending = false;
  const backoffMs = [0, 1000, 2000, 5000, 10000];
  let attempt = 0;
  // 只在前台重试：iOS 后台无法建连，回前台再由可见性事件重新触发。
  while (document.visibilityState === "visible" && !isLiveSocketOpen()) {
    try {
      appConnectionEpoch += 1; // Root 以此为 key，重连后整棵树以新 services 重挂并重新订阅。
      await connectAndRenderApp(bootstrap);
    } catch {
      await new Promise((resolve) =>
        setTimeout(resolve, backoffMs[Math.min(attempt, backoffMs.length - 1)]),
      );
      attempt += 1;
    }
  }
  reconnectInFlight = false;
  // 重试期间又断开、或曾回到后台：若仍需重连则再触发一次。
  if (reconnectPending && document.visibilityState === "visible" && !isLiveSocketOpen()) {
    void scheduleReconnect(bootstrap);
  }
}

function maybeReconnectOnForeground(bootstrap: WebBootstrapResult): void {
  // 僵尸 socket（iOS 冻结后仍 OPEN 但实际已死）需 keep-alive/PersistentProtocol 才能彻底探活；
  // 此处只处理已明确断开的情况，僵尸态兜底依赖 onClose 最终触发。
  if (autoReconnectEnabled && !isLiveSocketOpen()) {
    void scheduleReconnect(bootstrap);
  }
}

function installAutoReconnect(bootstrap: WebBootstrapResult): void {
  autoReconnectEnabled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      maybeReconnectOnForeground(bootstrap);
    }
  });
  window.addEventListener("online", () => {
    maybeReconnectOnForeground(bootstrap);
  });
  // iOS 从 bfcache 恢复走 pageshow.persisted，等同回到前台。
  window.addEventListener("pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted) {
      maybeReconnectOnForeground(bootstrap);
    }
  });
}

async function bootstrapWebApp() {
  const params = new URLSearchParams(window.location.search);
  if (isWebOAuthCallback(params)) {
    renderWebAuthCallbackPage();
    return;
  }

  if (isConversationSharePath(window.location.pathname)) {
    await renderConversationSharePage();
    return;
  }

  let bootstrap: WebBootstrapResult;
  try {
    bootstrap = await resolveWebBootstrap();
  } catch (error) {
    renderWebBootstrapError(error);
    return;
  }

  try {
    await connectAndRenderApp(bootstrap);
    // Регистрируем service worker для web push (само-гейт: no-op на http/desktop).
    void registerPushServiceWorker();
    // 仅普通 /ws 支持自动重连；/ws/remote/<id> 是一次性配对（服务端用后即删），重连会 4004。
    if (!params.get("remote")) {
      installAutoReconnect(bootstrap);
    }
  } catch (error) {
    renderWebBootstrapError(error);
  }
}

void bootstrapWebApp();
