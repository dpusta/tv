#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
SERVICE_USER="${SERVICE_USER:-${SUDO_USER:-$(id -un)}}"
SERVICE_GROUP="${SERVICE_GROUP:-$(id -gn "$SERVICE_USER")}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
UNIT_NAME="pocket-remote.service"
UNIT_PATH="/etc/systemd/system/$UNIT_NAME"
ENV_PATH="/etc/pocket-remote.env"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Node.js executable not found. Set NODE_BIN=/absolute/path/to/node." >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "Service user '$SERVICE_USER' does not exist." >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/node_modules" ]]; then
  echo "Dependencies are missing. Run 'npm install --omit=dev' first." >&2
  exit 1
fi

escape_sed() {
  printf '%s' "$1" | sed 's/[&|\\]/\\&/g'
}

tmp_unit="$(mktemp)"
trap 'rm -f "$tmp_unit"' EXIT

sed \
  -e "s|@SERVICE_USER@|$(escape_sed "$SERVICE_USER")|g" \
  -e "s|@SERVICE_GROUP@|$(escape_sed "$SERVICE_GROUP")|g" \
  -e "s|@APP_DIR@|$(escape_sed "$APP_DIR")|g" \
  -e "s|@NODE_BIN@|$(escape_sed "$NODE_BIN")|g" \
  "$SCRIPT_DIR/pocket-remote.service.in" > "$tmp_unit"

sudo install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0750 "$APP_DIR/data"
sudo chown -R "$SERVICE_USER:$SERVICE_GROUP" "$APP_DIR/data"
sudo install -o root -g root -m 0644 "$tmp_unit" "$UNIT_PATH"

if ! sudo test -e "$ENV_PATH"; then
  printf '%s\n' \
    '# Pocket Remote configuration' \
    'PORT=3000' \
    '# CHROMECAST_HOST=192.168.1.50' \
    '# CHROMECAST_NAME=Living Room TV' \
    | sudo tee "$ENV_PATH" >/dev/null
  sudo chmod 0644 "$ENV_PATH"
fi

sudo systemctl daemon-reload
sudo systemctl enable --now "$UNIT_NAME"
sudo systemctl --no-pager --full status "$UNIT_NAME"

echo
echo "Installed $UNIT_NAME for user $SERVICE_USER."
echo "Configuration: $ENV_PATH"
echo "Logs: journalctl -u $UNIT_NAME -f"
