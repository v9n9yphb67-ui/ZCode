/*
 * ZCode Web Push service worker.
 * Регистрируется только в secure context (HTTPS). Показывает системное уведомление
 * из серверного пуша и открывает/фокусирует приложение по клику.
 */
/* eslint-disable no-undef */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "ZCode";
  const options = {
    body: payload.body || "",
    // одинаковый tag для одной задачи + renotify:false => дубли (foreground + сервер)
    // схлопываются в одно уведомление, а не звенят дважды.
    tag: payload.tag || "zcode-task",
    renotify: false,
    icon: "/app-icon.png",
    badge: "/app-icon.png",
    data: { url: payload.url || "/", taskId: payload.taskId || "" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Приложение уже открыто — фокусируем существующую вкладку (в её URL уже есть token).
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          return;
        }
      }
      // Иначе открываем сохранённый при подписке URL (несёт token).
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
