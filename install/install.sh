#!/usr/bin/env bash
#
# ─── NOLMI SINGLE-HOST ONE-LINER-INSTALL (Distribution Etappe 2.3) ────────────
#
# Self-Hosting ohne TLS/Domain — erreichbar auf localhost bzw. der Server-IP.
# Automatisiert den Phase-4-B1/B2-Ablauf für den Single-Host-Fall: Docker
# prüfen/installieren, Repo holen, Secrets generieren, Stack bauen+starten,
# an das Onboarding übergeben.
#
#   curl -fsSL https://raw.githubusercontent.com/nolmi-ai/nolmi/main/install/install.sh | bash
#
# ODER aus einem Clone heraus:  bash install/install.sh
#
# Konfigurierbar über ENV (alle optional):
#   NOLMI_HOST     Adresse, unter der DEIN BROWSER den Server erreicht.
#                  Wenn NICHT gesetzt: wird automatisch erkannt (primäre IP) und
#                  — im interaktiven Terminal — zur Bestätigung vorgeschlagen.
#                  Diese Adresse wird build-time ins Web-Bundle gebacken; auf
#                  einem VPS MUSS sie die Server-IP/Domain sein (nicht localhost),
#                  sonst bricht der Remote-Login. Explizit: NOLMI_HOST=203.0.113.10
#   NOLMI_DIR      Ziel-Clone-Verzeichnis (Default $HOME/nolmi)
#   NOLMI_REPO_URL Repo-URL (Default https://github.com/nolmi-ai/nolmi.git)
#   NOLMI_BRANCH   Branch (Default main)
#
# TLS/Domain (HTTPS, app.<domain>) ist NICHT Teil dieses Skripts — das ist der
# spätere Schritt 3b (Traefik). Single-Host läuft über http.

set -euo pipefail

NOLMI_REPO_URL="${NOLMI_REPO_URL:-https://github.com/nolmi-ai/nolmi.git}"
NOLMI_DIR="${NOLMI_DIR:-$HOME/nolmi}"
NOLMI_HOST="${NOLMI_HOST:-}"   # leer = automatisch erkennen/erfragen (s. resolve_host)
NOLMI_BRANCH="${NOLMI_BRANCH:-main}"
COMPOSE_FILE="docker-compose.single-host.yml"

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ─── Host-Auflösung (DRY-Spiegel zu packages/cli) ────────────────────────────
# Primäre routbare IPv4 dieses Rechners — KEIN externer Dienst (entspricht
# detect-ip.ts). Linux: `ip route get` / `hostname -I`; macOS: `ipconfig`.
detect_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | grep -oE 'src [0-9.]+' | awk '{print $2}' | head -n1 || true)"
  fi
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  if [ -z "$ip" ] && command -v ipconfig >/dev/null 2>&1; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  fi
  printf '%s' "$ip"
}

# Setzt NOLMI_HOST, falls nicht explizit (ENV) gesetzt: TTY → Vorschlag +
# Rückfrage (Enter bestätigt), sonst erkannte IP (Fallback localhost) — jeweils
# LAUT geloggt. Spiegelt resolveHost() im Wrapper. Die .env-Formel bleibt gleich.
resolve_host() {
  [ -n "${NOLMI_HOST}" ] && return 0   # explizit gesetzt → kein Prompt
  local detected; detected="$(detect_ip)"
  if [ -t 0 ] && [ -t 1 ]; then
    local def="${detected:-localhost}"
    [ -n "$detected" ] && printf '  erkannte IP dieses Rechners: %s\n' "$detected"
    printf '  Adresse, unter der dein Browser den Server erreicht?\n'
    printf '  (IP oder Domain, ohne http:// und ohne Port) [%s]: ' "$def"
    local answer=""; read -r answer || answer=""
    NOLMI_HOST="${answer:-$def}"
  elif [ -n "$detected" ]; then
    NOLMI_HOST="$detected"
    warn "Kein TTY — nehme erkannte IP '${detected}' als Browser-Adresse (Override: NOLMI_HOST=…)."
  else
    NOLMI_HOST="localhost"
    warn "Kein TTY und keine IP erkannt — 'localhost' (für Remote NOLMI_HOST=<ip> setzen)."
  fi
  # Nachsichtige Normalisierung (DRY zu tryNormalizeHost): http(s):// + Slash weg.
  case "$NOLMI_HOST" in
    https://*) warn "HTTPS/Domain = TLS-Pfad (3b); Phase-1 macht http+IP — nutze die Adresse über http."; NOLMI_HOST="${NOLMI_HOST#https://}";;
    http://*)  NOLMI_HOST="${NOLMI_HOST#http://}";;
  esac
  NOLMI_HOST="${NOLMI_HOST%/}"
}

# ─── 1. OS / Grund-Tools ─────────────────────────────────────────────────────
log "1/7  Voraussetzungen prüfen"
case "$(uname -s)" in
  Linux|Darwin) ok "OS: $(uname -s)" ;;
  *) die "Nicht unterstütztes OS '$(uname -s)' — nur Linux/macOS." ;;
esac
command -v git >/dev/null 2>&1 || die "git fehlt — bitte installieren und erneut ausführen."
command -v openssl >/dev/null 2>&1 || die "openssl fehlt — bitte installieren und erneut ausführen."
ok "git + openssl vorhanden"

# ─── 2. Docker + Compose ─────────────────────────────────────────────────────
log "2/7  Docker prüfen"
if ! command -v docker >/dev/null 2>&1; then
  if [ "$(uname -s)" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then
    warn "Docker nicht gefunden — installiere über get.docker.com (sudo nötig) …"
    curl -fsSL https://get.docker.com | sh
  else
    die "Docker fehlt. macOS: Docker Desktop installieren
       (https://www.docker.com/products/docker-desktop), starten, dann erneut ausführen."
  fi
fi
docker compose version >/dev/null 2>&1 \
  || die "Docker-Compose-v2-Plugin fehlt (brauche 'docker compose', nicht das alte 'docker-compose')."
docker info >/dev/null 2>&1 \
  || die "Docker-Daemon nicht erreichbar / keine Rechte.
       Linux: 'sudo usermod -aG docker \$USER' + neu einloggen, oder Skript mit sudo ausführen.
       macOS: Docker Desktop starten."
ok "Docker + Compose v2 verfügbar"

# ─── 3. Repo bereitstellen ───────────────────────────────────────────────────
log "3/7  Repo bereitstellen"
if [ -f "package.json" ] && grep -q '"name": "nolmi"' package.json 2>/dev/null \
     && [ -f "docker/nolmi/${COMPOSE_FILE}" ]; then
  REPO_ROOT="$(pwd)"
  ok "Im Repo ausgeführt — nutze ${REPO_ROOT}"
elif [ -d "${NOLMI_DIR}/.git" ]; then
  git -C "${NOLMI_DIR}" pull --ff-only || warn "git pull übersprungen (lokale Änderungen?) — nutze Bestand."
  REPO_ROOT="${NOLMI_DIR}"
  ok "Bestehendes Repo aktualisiert: ${NOLMI_DIR}"
else
  git clone --branch "${NOLMI_BRANCH}" --depth 1 "${NOLMI_REPO_URL}" "${NOLMI_DIR}"
  REPO_ROOT="${NOLMI_DIR}"
  ok "Repo geklont: ${NOLMI_DIR}"
fi

ENV_DIR="${REPO_ROOT}/docker/nolmi"
ENV_FILE="${ENV_DIR}/.env"
[ -f "${ENV_DIR}/${COMPOSE_FILE}" ] || die "Compose-Datei fehlt: ${ENV_DIR}/${COMPOSE_FILE}"

# ─── 4. Secrets + .env ───────────────────────────────────────────────────────
log "4/7  Secrets + .env"
if [ -f "${ENV_FILE}" ]; then
  warn ".env existiert bereits (${ENV_FILE}) — Secrets werden NICHT neu erzeugt (idempotent)."
  # Host für die Schluss-URLs aus der bestehenden .env lesen (kein Prompt).
  existing_host="$(grep -E '^NEXT_PUBLIC_RUNTIME_URL=' "${ENV_FILE}" | head -n1 | sed -E 's|^NEXT_PUBLIC_RUNTIME_URL=http://([^:]+):4000.*|\1|' || true)"
  NOLMI_HOST="${existing_host:-localhost}"
  warn "Falsche Adresse in der .env? → Zeile NEXT_PUBLIC_RUNTIME_URL anpassen + neu bauen (oder im Wrapper: nolmi reconfigure-host)."
else
  # Browser-Adresse VOR dem Build auflösen — sie wird build-time ins Web-Bundle
  # gebacken (NEXT_PUBLIC_RUNTIME_URL). Falscher Wert = Remote-Login bricht.
  resolve_host
  ok "Browser-Adresse: ${NOLMI_HOST}"
  # Lokal generiert, NIE geloggt. Encryption-Key: 32 Byte base64 (= Format aus
  # key:generate / loadMasterKey). Session + Bridge-Token: 32 Byte hex.
  enc_key="$(openssl rand -base64 32)"
  session_secret="$(openssl rand -hex 32)"
  bridge_token="$(openssl rand -hex 32)"
  ( umask 077
    cat > "${ENV_FILE}" <<EOF
# Nolmi Single-Host .env — AUTO-GENERIERT von install/install.sh.
# NICHT committen, NICHT teilen.
#
# ⚠ NOLMI_ENCRYPTION_KEY UNBEDINGT SICHERN. Er verschlüsselt alle API-Keys und
#   OAuth-Tokens in der DB — ohne ihn sind diese Daten unwiederbringlich verloren.

NOLMI_ENCRYPTION_KEY=${enc_key}
NOLMI_SESSION_SECRET=${session_secret}
BRIDGE_REGISTER_TOKEN=${bridge_token}

# Single-Host (kein TLS/Domain):
SESSION_COOKIE_DOMAIN=
SESSION_COOKIE_SECURE=false
TELEGRAM_USE_POLLING=true
RUNTIME_PUBLIC_URL=
ACTIVE_PROVIDER=anthropic

# Adresse, unter der dein Browser den Server erreicht (localhost ODER http://<server-ip>).
# Steckt im Web-Client-Bundle (#126) — bei Änderung Web neu bauen.
NEXT_PUBLIC_RUNTIME_URL=http://${NOLMI_HOST}:4000
EOF
  )
  ok ".env erzeugt (${ENV_FILE}) — Secrets wurden NICHT ausgegeben."
  warn "Sichere ${ENV_FILE} (v.a. NOLMI_ENCRYPTION_KEY) an einem sicheren Ort."
fi

# ─── 5. Stack bauen + starten ────────────────────────────────────────────────
log "5/7  Stack bauen + starten (erster Build dauert ein paar Minuten)"
# Aus docker/nolmi/ heraus: Compose lädt ./.env automatisch, Build-Kontext
# ../.. = Repo-Root.
cd "${ENV_DIR}"
docker compose -f "${COMPOSE_FILE}" up --build -d
ok "Container gestartet"

# ─── 6. DB-Init ──────────────────────────────────────────────────────────────
log "6/7  DB-Init"
ok "Migrationen laufen idempotent im Container-CMD beim Boot (init-db.js) — kein manueller Schritt."

# ─── 7. Übergabe an das Onboarding ──────────────────────────────────────────
log "7/7  Fertig"
cat <<EOF

  Nolmi läuft (Single-Host, ohne TLS):
    Web:     http://${NOLMI_HOST}:3000
    Runtime: http://${NOLMI_HOST}:4000
    Bridge:  intern (nolmi-bridge:5100, Host-Port 5100)

  Nächste Schritte:
    1) Ersten Account anlegen (im Terminal, interaktiv):
         cd "${ENV_DIR}"
         docker compose -f ${COMPOSE_FILE} exec -it nolmi-runtime node dist/scripts/onboard.js
    2) Browser öffnen:  http://${NOLMI_HOST}:3000
       Als angelegter User einloggen — der Wizard führt durch die Twin-Anlage
       (Persona + LLM-Key + optionale Presets).

  Hinweise:
    • TLS/Domain (HTTPS, app.<deine-domain>) ist der spätere Schritt 3b (Traefik).
    • Auf einem öffentlichen VPS sind :3000/:4000/:5100 ungeschützt offen —
      ohne Reverse-Proxy/Firewall nur für vertrauenswürdige Netze geeignet.
    • Secret-Backup: ${ENV_FILE} sichern (NOLMI_ENCRYPTION_KEY!).
EOF
