/**
 * Клиентский Web Push (только web/PWA, secure context).
 *
 * Регистрирует service worker `/sw.js`, запрашивает разрешение на уведомления и
 * подписывается через PushManager, отдавая подписку серверу (`/api/push/*`). Всё под
 * feature-detection: на desktop/http функции — безопасные no-op, ничего не ломают.
 *
 * Секьюр-контекст обязателен: на http:// у браузера нет ни ServiceWorker, ни
 * PushManager, ни Notification — для работы push-уведомлений требуется HTTPS (напр. через reverse-proxy).
 */

const SERVICE_WORKER_URL = "/sw.js";

export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getWebPushPermission(): NotificationPermission | "unsupported" {
  if (!isWebPushSupported()) return "unsupported";
  return Notification.permission;
}

/** Регистрирует SW при загрузке приложения (идемпотентно). Вызывать только на web. */
export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) return null;
  try {
    return await navigator.serviceWorker.register(SERVICE_WORKER_URL);
  } catch {
    return null;
  }
}

/** true = на этом устройстве уже есть активная подписка и разрешение выдано. */
export async function isWebPushActive(): Promise<boolean> {
  if (!isWebPushSupported() || Notification.permission !== "granted") return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputArray;
}

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const response = await fetch("/api/push/vapid-public-key", { credentials: "same-origin" });
    if (!response.ok) return null;
    const body = (await response.json()) as { publicKey?: string | null };
    return body.publicKey ?? null;
  } catch {
    return null;
  }
}

export type EnableWebPushResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unsupported" | "permission_denied" | "no_vapid" | "subscribe_failed" | "server_failed";
    };

/** Запрашивает разрешение, подписывается и регистрирует подписку на сервере. */
export async function enableWebPush(): Promise<EnableWebPushResult> {
  if (!isWebPushSupported()) return { ok: false, reason: "unsupported" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "permission_denied" };

  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) return { ok: false, reason: "no_vapid" };

  let subscription: PushSubscription;
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));
  } catch {
    return { ok: false, reason: "subscribe_failed" };
  }

  try {
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      // appUrl несёт token — сервер вернёт его в пуше, чтобы клик открывал авторизованную вкладку.
      body: JSON.stringify({ subscription: subscription.toJSON(), appUrl: window.location.href }),
    });
    if (!response.ok) return { ok: false, reason: "server_failed" };
  } catch {
    return { ok: false, reason: "server_failed" };
  }

  return { ok: true };
}

/** Отписывает устройство локально и на сервере. */
export async function disableWebPush(): Promise<void> {
  if (!isWebPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const { endpoint } = subscription;
    await subscription.unsubscribe().catch(() => undefined);
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    }).catch(() => undefined);
  } catch {
    // отписка — best-effort, не критично для UI
  }
}

