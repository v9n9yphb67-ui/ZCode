/**
 * Web Push для мобильного PWA: сервер сам шлёт уведомление на телефон, когда фоновая
 * задача достигает терминального состояния — работает, даже если PWA закрыт ( push
 * доставляется push-сервисом браузера, не открытой вкладкой).
 *
 * Хук — тот же сигнал, что рисует фоновый бейдж непрочитанного: workspace event
 * `workspace_task_list_changed` с `unreadSignal === "background_terminal"`. Он
 * рождается в task-index syncer по факту phase-перехода агента (runtime-driven, не
 * зависит от подключённого клиента), поэтому пуш срабатывает и с закрытым приложением.
 *
 * Требует secure context (HTTPS) на стороне клиента — иначе браузер не даст подписаться
 * (PushManager/Notification недоступны на http). Для сред без HTTPS используется ntfy-мост.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { IZCodeTaskService, type ServiceCollection } from "@zcode/services";
import { getAppConfigDir } from "@zcode/services/node";
import type { ZCodeWorkspaceEvent } from "@zcode/shared";

// web-push — CJS-пакет: его функции лежат на `module.exports = {…}` (literal), и
// cjs-module-lexer не распознаёт их как named exports, поэтому `import * as` даёт
// namespace без generateVAPIDKeys (всё висит на .default). Берём модуль через
// createRequire — так получаем настоящий module.exports со всеми функциями.
const nodeRequire = createRequire(import.meta.url);
const webpush = nodeRequire("web-push") as typeof import("web-push");

interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  appUrl?: string;
  createdAt: number;
}

interface WebPushStore {
  vapid: { publicKey: string; privateKey: string };
  subscriptions: StoredSubscription[];
  /** ntfy-мост: сервер POST-ит уведомление сюда при завершении задачи (работает по http, без VPN). */
  ntfy?: { topic: string; server: string };
}

/**
 * VAPID subject должен быть валидным mailto:/https: — Apple Web Push (web.push.apple.com)
 * строго проверяет его и отвергает JWT с невалидным доменом ошибкой 403 BadJwtToken
 * (например `.local` TLD не проходит). Используем https-URL проекта — Apple его принимает.
 */
const VAPID_SUBJECT = "https://github.com/zcode-touch/zcode";

export interface WebPushService {
  getVapidPublicKey(): string | null;
  addSubscription(subscription: unknown, appUrl?: unknown): Promise<{ ok: boolean; error?: string }>;
  removeSubscription(endpoint: unknown): Promise<void>;
  dispose(): void;
}

function isValidSubscription(value: unknown): value is StoredSubscription {
  if (!value || typeof value !== "object") return false;
  const sub = value as Record<string, unknown>;
  const keys = sub.keys as Record<string, unknown> | undefined;
  return (
    typeof sub.endpoint === "string" &&
    sub.endpoint.length > 0 &&
    !!keys &&
    typeof keys.p256dh === "string" &&
    typeof keys.auth === "string"
  );
}

export function createWebPushService(params: {
  services: ServiceCollection;
  workspaces: Array<{ path: string }>;
  log: (...args: unknown[]) => void;
}): WebPushService {
  const { services, workspaces, log } = params;
  const storePath = join(getAppConfigDir(), "web-push.json");
  let store: WebPushStore | null = null;
  let writeChain: Promise<void> = Promise.resolve();
  const disposeFns: Array<() => void> = [];
  let disposed = false;

  function persist(): Promise<void> {
    const snapshot = store;
    if (!snapshot) return Promise.resolve();
    writeChain = writeChain
      .then(async () => {
        await mkdir(dirname(storePath), { recursive: true });
        await writeFile(storePath, JSON.stringify(snapshot, null, 2), "utf-8");
      })
      .catch((error: unknown) => log("[web-push] запись состояния не удалась:", error));
    return writeChain;
  }

  function attachWorkspaceListeners(): void {
    if (disposed) return;
    const taskService = services.getOptional(IZCodeTaskService);
    if (!taskService) {
      log("[web-push] IZCodeTaskService недоступен; пуш о завершении задач отключён");
      return;
    }
    for (const ws of workspaces) {
      if (!ws.path) continue;
      const disposable = taskService.onDynamicWorkspaceEvent(ws.path)((event: ZCodeWorkspaceEvent) => {
        handleWorkspaceEvent(event);
      });
      disposeFns.push(() => disposable.dispose());
    }
  }

  function handleWorkspaceEvent(event: ZCodeWorkspaceEvent): void {
    if (event.type !== "workspace_task_list_changed") return;
    // unreadSignal хост выставляет только на терминальном переходе, достойном фонового
    // уведомления; обычные resume/snapshot/status его не несут — так мы не спамим.
    if (event.unreadSignal !== "background_terminal") return;
    const meta = event.taskMeta;
    const title = meta?.title?.trim() || "Задача";
    const failed = meta?.status === "error";
    const taskId = meta?.taskId ?? event.taskId ?? "";
    const body = failed ? `Задача завершилась с ошибкой: ${title}` : `Задача завершена: ${title}`;
    void broadcast({
      title: "ZCode",
      body,
      tag: `zcode-task:${taskId}:${failed ? "failed" : "completed"}`,
      taskId,
    });
    void sendNtfy(body, failed);
  }

  async function sendNtfy(body: string, failed: boolean): Promise<void> {
    await ready;
    const ntfy = store?.ntfy;
    if (!ntfy?.topic) return;
    try {
      // Заголовок ntfy шлём только ASCII ("ZCode") — не-ASCII в HTTP-заголовке ломается;
      // русский текст едет в теле (UTF-8, целое).
      await fetch(`${ntfy.server}/${encodeURIComponent(ntfy.topic)}`, {
        method: "POST",
        headers: {
          Title: "ZCode",
          Priority: failed ? "high" : "default",
          Tags: failed ? "rotating_light" : "white_check_mark",
        },
        body,
      });
    } catch (error: unknown) {
      log("[ntfy] отправка не удалась:", error);
    }
  }

  async function broadcast(payload: {
    title: string;
    body: string;
    tag: string;
    taskId: string;
  }): Promise<void> {
    await ready;
    if (!store || store.subscriptions.length === 0) return;
    const dead: string[] = [];
    await Promise.all(
      store.subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({ ...payload, url: sub.appUrl }),
          );
        } catch (error: unknown) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          // 404/410 = подписка мертва (устройство отписалось/протухло) → выпалываем.
          if (statusCode === 404 || statusCode === 410) {
            dead.push(sub.endpoint);
          } else {
            log("[web-push] отправка не удалась:", statusCode ?? error);
          }
        }
      }),
    );
    if (dead.length > 0 && store) {
      store.subscriptions = store.subscriptions.filter((s) => !dead.includes(s.endpoint));
      await persist();
    }
  }

  const ready: Promise<void> = (async () => {
    let loaded: WebPushStore | null = null;
    try {
      const parsed = JSON.parse(await readFile(storePath, "utf-8")) as Partial<WebPushStore>;
      if (parsed?.vapid?.publicKey && parsed.vapid.privateKey) {
        loaded = {
          vapid: parsed.vapid,
          subscriptions: Array.isArray(parsed.subscriptions)
            ? parsed.subscriptions.filter(isValidSubscription)
            : [],
          // Тему ntfy обязательно переносим из файла: без этого она не читалась и
          // генерировалась заново на КАЖДОМ старте сервера — тогда подписка на телефоне
          // (на прежнюю тему) переставала совпадать и уведомления «пропадали».
          ...(parsed.ntfy?.topic ? { ntfy: parsed.ntfy } : {}),
        };
      }
    } catch {
      // файла ещё нет — сгенерируем ключи ниже
    }
    if (!loaded) {
      const vapid = webpush.generateVAPIDKeys();
      loaded = { vapid: { publicKey: vapid.publicKey, privateKey: vapid.privateKey }, subscriptions: [] };
    }
    store = loaded;
    webpush.setVapidDetails(VAPID_SUBJECT, loaded.vapid.publicKey, loaded.vapid.privateKey);
    if (!loaded.ntfy?.topic) {
      // Тема на публичном ntfy.sh: длинное случайное имя = практическая приватность.
      loaded.ntfy = { topic: `zcode-${randomBytes(9).toString("hex")}`, server: "https://ntfy.sh" };
    }
    log(`[ntfy] тема уведомлений: ${loaded.ntfy.server}/${loaded.ntfy.topic}`);
    await persist();
    attachWorkspaceListeners();
  })().catch((error: unknown) => log("[web-push] инициализация не удалась:", error));

  return {
    getVapidPublicKey() {
      return store?.vapid.publicKey ?? null;
    },
    async addSubscription(subscription, appUrl) {
      await ready;
      if (!store) return { ok: false, error: "not_ready" };
      if (!isValidSubscription(subscription)) return { ok: false, error: "invalid_subscription" };
      const incoming = subscription;
      const url = typeof appUrl === "string" ? appUrl : undefined;
      const existing = store.subscriptions.find((s) => s.endpoint === incoming.endpoint);
      if (existing) {
        existing.keys = incoming.keys;
        if (url) existing.appUrl = url;
      } else {
        store.subscriptions.push({
          endpoint: incoming.endpoint,
          keys: incoming.keys,
          ...(url ? { appUrl: url } : {}),
          createdAt: Date.now(),
        });
      }
      await persist();
      return { ok: true };
    },
    async removeSubscription(endpoint) {
      await ready;
      if (!store || typeof endpoint !== "string") return;
      const before = store.subscriptions.length;
      store.subscriptions = store.subscriptions.filter((s) => s.endpoint !== endpoint);
      if (store.subscriptions.length !== before) await persist();
    },
    dispose() {
      disposed = true;
      for (const fn of disposeFns) {
        try {
          fn();
        } catch {
          // отписка не должна ронять остановку сервера
        }
      }
      disposeFns.length = 0;
    },
  };
}
