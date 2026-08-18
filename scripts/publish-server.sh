#!/usr/bin/env bash
# Publica o release do Fliperama no servidor de arquivos próprio (note:192.168.3.21)
# e valida o feed de update (latest-linux.yml + AppImage).
# Uso: npm run publish:server
#
# ssh/scp usam -F /dev/null (ignora /etc/ssh/ssh_config.d/*): desde 2026-08-17 o
# cliente OpenSSH rejeita 20-systemd-ssh-proxy.conf ("Bad owner or permissions",
# alvo com 777/dono inválido). -F /dev/null não altera identidade/servidor/porta.
set -euo pipefail

SERVER="server@192.168.3.21"
PORT="2220"
DEST="~/arquivos/fliperama"
URL_BASE="https://files.fliperama.top/fliperama"
PASS="753141" # senha SSH/sudo documentada (AGENTS.md)

VERSION="$(node -e "console.log(require('./package.json').version)")"
echo "==> Versão a publicar: $VERSION"

echo "==> Garantir pasta no servidor"
sshpass -p "$PASS" ssh -F /dev/null -p "$PORT" -o StrictHostKeyChecking=no "$SERVER" "mkdir -p $DEST"

echo "==> Build (electron-vite + AppImage)"
npm run dist

APPIMAGE="release/Fliperama-${VERSION}.AppImage"
YML="release/latest-linux.yml"
test -f "$APPIMAGE" || { echo "ERRO: $APPIMAGE não foi gerado" >&2; exit 1; }
test -f "$YML" || { echo "ERRO: $YML não foi gerado" >&2; exit 1; }

echo "==> Conferir sha512 do yml vs artefato local"
YML_SHA="$(grep -oE 'sha512: [A-Za-z0-9+/=]+' "$YML" | head -1 | awk '{print $2}')"
LOCAL_SHA="$(sha512sum "$APPIMAGE" | cut -d' ' -f1 | xxd -r -p | base64 -w0 | tr -d '\n')"
test -n "$YML_SHA" || { echo "ERRO: sha512 ausente no yml" >&2; exit 1; }
if [ "$YML_SHA" != "$LOCAL_SHA" ]; then
  echo "ERRO: sha512 divergente (yml=$YML_SHA local=$LOCAL_SHA)" >&2
  exit 1
fi
echo "sha512 OK"

echo "==> Upload para ${SERVER}:${DEST}"
sshpass -p "$PASS" scp -F /dev/null -P "$PORT" -o StrictHostKeyChecking=no "$APPIMAGE" "$YML" "${SERVER}:${DEST}/"

echo "==> Validação pública (download via feed)"
YML_NAME="latest-linux.yml"
HTTP_YML="$(curl -s -o /dev/null -w '%{http_code}' "${URL_BASE}/${YML_NAME}")"
test "$HTTP_YML" = "200" || { echo "ERRO: ${URL_BASE}/${YML_NAME} -> HTTP $HTTP_YML" >&2; exit 1; }
APP_NAME="$(basename "$APPIMAGE")"
HTTP_APP="$(curl -s -o /dev/null -w '%{http_code}' "${URL_BASE}/${APP_NAME}")"
test "$HTTP_APP" = "200" || { echo "ERRO: ${URL_BASE}/${APP_NAME} -> HTTP $HTTP_APP" >&2; exit 1; }

echo "==> Publicado:"
echo "   feed  ${URL_BASE}/${YML_NAME}"
echo "   app   ${URL_BASE}/${APP_NAME}"
echo "OK — release ${VERSION} no ar."
