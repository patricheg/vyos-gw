#!/bin/bash
# vyos-gw bootstrap: свежий VyOS -> веб-консоль контейнером на самом роутере.
#
# Использование (на консоли VyOS, после настройки IP и default route):
#   curl -sL https://raw.githubusercontent.com/OWNER/vyos-gw/main/bootstrap.sh | sudo bash
#
# Что делает:
#   1. Включает HTTPS API VyOS на 8443 со случайным ключом
#   2. Скачивает исходники из GitHub и собирает образ podman на роутере
#   3. Прописывает контейнер vyos-gw в конфиг (автозапуск, host network)
#   4. commit + save; печатает URL веб-консоли
set -euo pipefail

GITHUB_REPO="OWNER/vyos-gw"
REF="main"
APP_PORT=8001
API_PORT=8443
APP_DIR="/config/auth/vyos-gw"
IMAGE="localhost/vyos-gw:local"

[ "$(id -u)" = "0" ] || { echo "Запусти через sudo: curl -sL ... | sudo bash"; exit 1; }
for cmd in curl tar podman openssl; do
    command -v "$cmd" >/dev/null || { echo "Нет команды: $cmd"; exit 1; }
done

# API-ключ: генерируем один раз, дальше переиспользуем
mkdir -p "$APP_DIR/data"
if [ ! -s "$APP_DIR/api.key" ]; then
    openssl rand -hex 20 > "$APP_DIR/api.key"
    chmod 600 "$APP_DIR/api.key"
fi
API_KEY="$(cat "$APP_DIR/api.key")"

# Скачиваем и собираем образ
echo ">> Скачиваю исходники ($GITHUB_REPO@$REF)..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "https://codeload.github.com/$GITHUB_REPO/tar.gz/refs/heads/$REF" -o "$TMP/src.tgz"
tar -xzf "$TMP/src.tgz" -C "$TMP"
SRC="$(find "$TMP" -maxdepth 1 -type d -name 'vyos-gw-*' | head -1)"
[ -n "$SRC" ] || { echo "Не удалось распаковать исходники"; exit 1; }

echo ">> Собираю образ $IMAGE (первая сборка долгая, 5-10 минут)..."
podman build -f "$SRC/deploy/Dockerfile" -t "$IMAGE" "$SRC"

# Конфигурация VyOS: HTTPS API + контейнер
echo ">> Настраиваю VyOS API и контейнер..."
cat > "$TMP/vyos-setup.sh" <<EOF
#!/bin/vbash
source /opt/vyatta/etc/functions/script-template
configure
set service https api rest
set service https api keys id vyos-gw key $API_KEY
set service https port $API_PORT
set container name vyos-gw image $IMAGE
set container name vyos-gw allow-host-networks
set container name vyos-gw restart always
set container name vyos-gw volume auth source /config/auth
set container name vyos-gw volume auth destination /config/auth
set container name vyos-gw volume auth mode rw
set container name vyos-gw volume data source $APP_DIR/data
set container name vyos-gw volume data destination /data
set container name vyos-gw volume data mode rw
commit
save
exit
EOF
chmod +x "$TMP/vyos-setup.sh"
if ! "$TMP/vyos-setup.sh"; then
    echo "!! Ошибка commit — конфиг не применён"
    exit 1
fi

IP="$(ip -4 -o addr show scope global | awk '{split($4,a,"/"); print a[1]}' | head -1)"
echo ""
echo "==============================================="
echo " Готово! Веб-консоль: http://${IP:-<адрес>}:$APP_PORT"
echo " При первом входе задайте логин/пароль админа."
echo " API-ключ устройства сохранён в $APP_DIR/api.key"
echo "==============================================="
