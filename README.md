# ME Network Terminal (1.7.10)

Веб-терминал AE2 + OpenComputers.
Синхронизация через **GitHub Gist**, сайт на **GitHub Pages**, вход по **логину/паролю**.

## Двусторонняя синхронизация

| Файл в Gist | Кто пишет | Кто читает | Зачем |
|-------------|-----------|------------|--------|
| `me_state.json` | OpenComputers | Сайт | Предметы, CPU, энергия |
| `craft_queue.json` | Сайт (после логина) | OpenComputers | Очередь крафтов |

Иконки только на сайте (не в Gist). Залей папку `icons/` из архива в этот репозиторий.

## Авторизация

Файл `data/users.json` — список пользователей.

| Логин | Пароль (смени!) | Роль |
|-------|-----------------|------|
| **LiwMorgan** | `change_me_admin` | admin |
| teammate1 | `change_me_1` | user |
| teammate2 | `change_me_2` | user |

Без входа сайт закрыт.

## Быстрый старт

1. Создай Gist с `me_state.json` и `craft_queue.json`
2. Token с scope `gist`
3. В `me_terminal.lua` впиши token и gistId
4. Adapter + Internet Card → запусти `me_terminal`
5. Pages: Settings → Pages → Deploy from branch main
6. На сайте: логин → Settings → username / Gist ID / token

**Важно:** смени пароли в `data/users.json` перед тем как шарить сайт.
