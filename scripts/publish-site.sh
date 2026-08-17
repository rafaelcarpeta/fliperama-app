#!/usr/bin/env bash
# Publica o site institucional do Fliperama no servidor (note:192.168.3.21).
# Faz backup do index.html atual, sincroniza site/ -> ~/www/ via rsync
# (preserva arquivos não tocados pelo site) e valida o resultado via HTTPS.
#
# Uso: npm run publish:site
set -euo pipefail

SERVER="server@192.168.3.21"
PORT="2220"
DEST="~/www"
URL_BASE="https://fliperama.top"
LOCAL="site"
PASS="753141" # senha SSH documentada (AGENTS.md)

# Garante rsync no servidor e local
command -v rsync >/dev/null 2>&1 || { echo "ERRO: rsync não instalado localmente" >&2; exit 1; }

echo "==> Conferir arquivos locais"
test -f "$LOCAL/index.html" || { echo "ERRO: $LOCAL/index.html ausente" >&2; exit 1; }
test -f "$LOCAL/styles.css"   || { echo "ERRO: $LOCAL/styles.css ausente"   >&2; exit 1; }
test -f "$LOCAL/app.js"       || { echo "ERRO: $LOCAL/app.js ausente"       >&2; exit 1; }
test -f "$LOCAL/i18n.js"      || { echo "ERRO: $LOCAL/i18n.js ausente"      >&2; exit 1; }
for loc in pt-BR en es; do
  test -f "$LOCAL/i18n/$loc.json" || { echo "ERRO: $LOCAL/i18n/$loc.json ausente" >&2; exit 1; }
done
test -f "$LOCAL/assets/logo.png" || { echo "ERRO: logo ausente em $LOCAL/assets/" >&2; exit 1; }

echo "==> Backup do index.html atual no servidor (se existir)"
sshpass -p "$PASS" ssh -p "$PORT" -o StrictHostKeyChecking=no "$SERVER" \
  "if [ -f ${DEST}/index.html ]; then cp ${DEST}/index.html ${DEST}/index.html.bak-\$(date +%Y%m%d-%H%M%S); fi; mkdir -p ${DEST}/assets/screenshots ${DEST}/assets/launchers ${DEST}/assets/fonts ${DEST}/i18n"

echo "==> Cache-busting: injetar ?v=<hash> nos assets do index.html"
BUILD_HASH="$(date +%s)"
TMP="$(mktemp -d)"
cp -a "$LOCAL/." "$TMP/"
sed -i "s/__BUILD_HASH__/$BUILD_HASH/g" "$TMP/index.html"
LOCAL="$TMP"

echo "==> Sync site/ -> ${SERVER}:${DEST}/ (rsync preserva arquivos não tocados)"
# -a = archive (perms/times), --delete = remove arquivos do server que não existem localmente,
# --exclude = nunca deletar backups .bak-*; trailing slash em src copia o conteúdo de site/.
sshpass -p "$PASS" rsync -a --delete \
  --exclude '.bak-*' \
  -e "ssh -p $PORT -o StrictHostKeyChecking=no" \
  "$LOCAL/" "${SERVER}:${DEST}/"

echo "==> Validação pública (HTTP 200)"
PATHS=(
  "/"
  "/robots.txt"
  "/sitemap.xml"
  "/styles.css"
  "/app.js"
  "/i18n.js"
  "/i18n/pt-BR.json"
  "/i18n/en.json"
  "/i18n/es.json"
  "/assets/logo.png"
  "/assets/favicon.png"
  "/assets/screenshots/1.png"
  "/assets/screenshots/2.png"
  "/assets/screenshots/3.png"
  "/assets/screenshots/4.png"
  "/assets/launchers/steam.png"
  "/assets/launchers/epic.png"
  "/assets/launchers/gog.png"
  "/assets/launchers/battlenet.png"
  "/assets/launchers/ea.png"
  "/assets/launchers/ubisoft.png"
  "/assets/launchers/amazon.png"
  "/assets/launchers/rockstar.png"
  "/assets/fonts/Inter-400.woff2"
  "/assets/fonts/Inter-600.woff2"
  "/assets/fonts/Inter-800.woff2"
)
for p in "${PATHS[@]}"; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "${URL_BASE}${p}")"
  if [ "$CODE" != "200" ]; then
    echo "ERRO: ${URL_BASE}${p} -> HTTP $CODE" >&2
    exit 1
  fi
  echo "  200  ${URL_BASE}${p}"
done

rm -rf "$TMP"

echo "OK — site publicado em $URL_BASE/"
