# vyos-gw

Веб-консоль управления VyOS: firewall, NAT, HAProxy (в отдельном контейнере, с GeoIP и SNI-сертификатами), PKI/Let's Encrypt, маршруты, интерфейсы, сервисы, логи, системные ресурсы.

## Быстрый старт (bootstrap на свежем VyOS)

На консоли свежеустановленного VyOS настройте адрес и маршрут по умолчанию:

```
configure
set interfaces ethernet eth0 address 192.0.2.10/24
set protocols static route 0.0.0.0/0 next-hop 192.0.2.1
set system name-server 8.8.8.8
commit
save
```

Затем одна команда:

```
curl -sL https://raw.githubusercontent.com/patricheg/vyos-gw/main/bootstrap.sh | sudo bash
```

Скрипт включит HTTPS API (8443), соберёт образ приложения прямо на роутере и поднимет контейнер `vyos-gw`. По завершении веб-консоль доступна на `http://<адрес>:8001` — при первом входе задайте логин/пароль админа.

Больше ничего не нужно: SSH можно выключить, ПК не требуется, всё хранится на роутере (`/config/auth/`).

## Как устроено

- `backend/` — FastAPI, работает через VyOS HTTPS API; в контейнере на роутере файловый доступ локальный, SSH не используется.
- `frontend/` — React + Vite + Tailwind; собирается внутри образа (multi-stage `deploy/Dockerfile`).
- `deploy/Dockerfile` — self-contained образ (build context = корень репо).
- `bootstrap.sh` — zero-touch установка на свежий VyOS.

## Режим разработки на ПК (Windows)

```
cd backend
python -m venv venv && venv/Scripts/pip install -r requirements.txt
# создать backend/.env: VYOS_API_URL=https://<router>:8443, VYOS_API_KEY=<key>
venv/Scripts/python run_server.py
```

Frontend: `cd frontend && npm ci && npm run dev` (или `npm run build` — бэкенд раздаёт `dist`).

## Примечания

- HAProxy-модель, сертификаты и geoip-база хранятся файлами в `/config/auth/haproxy/`, а не в `config.boot` — длинные значения в конфиге ломают загрузку VyOS.
- Let's Encrypt: выпуск через встроенный ACME VyOS, кэш сертификатов — в data-каталоге приложения.
