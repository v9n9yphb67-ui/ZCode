# ZCode Web & Mobile PWA Edition (`iphone-web`)

[English](README.web.md#english) | [Русский](README.web.md#русский)

---

## Русский

Эта ветка/сборка содержит улучшения для автономной работы ZCode через браузер и мобильный PWA (iOS Safari / Android Chrome) по локальной сети или через защищённый reverse-proxy.

### Ключевые улучшения

1. **Адаптация под мобильные устройства и iOS Safari / PWA:**
   * **Устранение задержек ввода:** оптимизирован ввод текста в `LexicalChatInput` и сохранение черновика, устранены микрофризы при редактировании и удалении слов в мобильном Safari.
   * **Контроль фокуса и клавиатуры:** отключено принудительное открытие экранной клавиатуры при запуске приложения и смене сессий. Клавиатура открывается только при явном нажатии на поле ввода.
   * **Предотвращение сползания экрана:** зафиксирована область видимости (`viewport-fit=cover`, `overscroll-behavior: none`), устранён эффект «резинки» всего окна и нежелательное масштабирование полей ввода.
   * **Плавный скролл:** включён аппаратный momentum-скролл iOS (`-webkit-overflow-scrolling: touch`) и изоляция стилей для длинных сессий диалогов.
   * **Мобильные шторки (Drawers):** левый сайдбар и правая панель (`side-pane`) открываются в виде удобных мобильных шторок с затемнением и кнопками закрытия вместо сжатия экрана.
   * **Полифиллы для LAN/HTTP:** поддержка прикрепления медиафайлов (чистый SHA-256 fallback) и копирования в буфер обмена в незащищённом локальном контексте (HTTP).

2. **Полная русская локализация:**
   * Полный перевод интерфейса (более 5400 ключей) с единым глоссарием терминов разработки.
   * Переключатель языка («Ру») в нижнем подвале сайдбара.
   * Валидация локали `ru-RU` в общих схемах протокола без ошибок сохранения настроек.

3. **Multi-Workspace и серверный рантайм:**
   * Поддержка нескольких рабочих директорий через разделитель `;` в `ZCODE_SERVER_WORKSPACE`.
   * Раздел «Задачи» корректно связывается с общим воркспейсом бесед и отображается в списке проектов.
   * Нормализация длинных путей Windows для защиты от сбоев `fs.watch` в libuv.
   * Надёжное восстановление последней активной сессии при выгрузке вкладки PWA из памяти.

4. **Уведомления без необходимости VPN (ntfy.sh):**
   * Встроенный ntfy-мост: сервер отправляет фоновые push-уведомления на `https://ntfy.sh/<случайная_тема>` при завершении или ошибке задачи по обычному HTTP.
   * Поддержка приложения ntfy из App Store / Google Play.

5. **MCP-инструменты в веб-интерфейсе:**
   * Устранена гонка при старте медленных внешних MCP-серверов.
   * Синхронизация статусов MCP через RPC с отображением тумблеров в настройках веб-клиента.

---

### Запуск и использование

#### Запуск локального веб-сервера
```bash
# Запуск через установленный CLI:
zcode --web --host 0.0.0.0 --port 3040

# Или запуск из исходного кода репозитория:
node packages/server/dist/entry-http.js
```

При первом запуске сервер сгенерирует токен авторизации и выведет ссылку для подключения:
```
http://<IP_ВАШЕГО_ПК>:3040/?token=<СЕКРЕТНЫЙ_ТОКЕН>
```

#### Добавление на домашний экран (PWA на iPhone / Android)
1. Откройте полученную ссылку в браузере Safari на iPhone (или Chrome на Android), находясь в одной сети Wi-Fi с ПК.
2. В Safari нажмите кнопку **Поделиться** (Share) -> **На экран «Домой»** (Add to Home Screen).
3. Запустите ZCode с домашнего экрана — приложение работает в полноэкранном автономном режиме (Standalone PWA).

#### Настройка уведомлений ntfy
1. Установите приложение **ntfy** из App Store или Google Play.
2. Подпишитесь на тему, указанную в консоли сервера при старте (или в `~/.zcode/v2/web-push.json`).
3. При завершении длительных фоновых задач на телефон поступит уведомление, даже когда экран выключен или PWA свернут.

---

### Безопасность и дисклеймер

* **Только локальная сеть / Secure Context:** данный веб-сервер предназначен для использования в доверенной домашней сети (LAN) или за защищённым обратным прокси-сервером (Reverse Proxy с HTTPS/TLS).
* **Не открывайте порт 3040 в публичный интернет** без дополнительного фаервола, VPN или шифрования трафика.
* Храните токен авторизации в секрете. После первой публикации рекомендуется сменить токен в настройках.

---

### Лицензия

Оригинальный проект ZCode разработан авторами [zai-org/ZCode](https://github.com/zai-org/ZCode) и распространяется под лицензией **Apache License 2.0**.
Все оригинальные файлы лицензии (`LICENSE`), уведомлений (`NOTICE.md`) и сторонних компонентов (`THIRD-PARTY-NOTICES.md`) полностью сохранены в репозитории.

---

## English

This branch/edition provides standalone Web and Mobile PWA enhancements for ZCode over local network (LAN) or secure reverse-proxy.

### Key Features
* **Mobile & iOS PWA optimizations:** lag-free typing in Safari, disabled unexpected keyboard popups on open, fixed rubber-banding viewport, smooth momentum scrolling, responsive drawer overlays.
* **Full Russian localization:** 5,400+ strings translated, language toggle in footer, protocol schema integration.
* **Multi-workspace support:** semicolon-separated workspaces via `ZCODE_SERVER_WORKSPACE`, persistent sessions on mobile tab discard.
* **ntfy.sh notification bridge:** push notifications for completed/failed background tasks over plain HTTP.
* **MCP sync in web:** fixes MCP server startup race condition and reflects tools in web UI settings.

### Security Notice
* Intended for private trusted networks (LAN) or behind an encrypted HTTPS reverse proxy.
* Do not expose raw HTTP port 3040 directly to the public internet.
* All original Apache 2.0 licenses and notices from `zai-org/ZCode` are strictly preserved.
