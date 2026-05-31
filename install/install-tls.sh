#!/usr/bin/env bash
#
# ─── NOLMI TLS/DOMAIN-INSTALL (Distribution Schritt 3b) ───────────────────────
#
# Self-Hosting MIT Domain + HTTPS: app./runtime./bridge.<DOMAIN> hinter Traefik
# (Let's-Encrypt-Certs, BasicAuth). Das dritte Self-Hosting-Szenario neben dem
# TLS-freien Single-Host (install/install.sh, Szenario 1+2).
#
#   curl -fsSL https://raw.githubusercontent.com/nolmi-ai/nolmi/main/install/install-tls.sh | DOMAIN=deine-domain.tld bash
#
# ODER aus einem Clone heraus:  DOMAIN=deine-domain.tld bash install/install-tls.sh
#
# Diese Variante automatisiert den in Phase 4 manuell verifizierten TLS-Pfad und
# baut die vier §7-Cookbook-Befunde fest ein (traefik:v3.6, external-Netz,
# htpasswd am Traefik-Stack, Staging→Prod-Flip mit Store-Reset). Der eigentliche
# Cert-Flip auf Produktion ist BEWUSST getrennt: `install/tls-promote.sh`, erst
# nachdem Staging grün ist (Rate-Limit-Schutz der echten Domain).
#
# Konfigurierbar über ENV:
#   DOMAIN        (PFLICHT) deine Domain, z.B. DOMAIN=nolmi.example.com
#   ACME_EMAIL    Mail für Let's-Encrypt (Default admin@<DOMAIN>)
#   NOLMI_DIR     Ziel-Clone-Verzeichnis (Default $HOME/nolmi)
#   NOLMI_REPO_URL / NOLMI_BRANCH   Repo-Quelle (Default github.com/nolmi-ai/nolmi, main)
#   BASICAUTH_USER / BASICAUTH_PASSWORD   BasicAuth-Credentials (sonst interaktiv)

set -euo pipefail

NOLMI_REPO_URL="${NOLMI_REPO_URL:-https://github.com/nolmi-ai/nolmi.git}"
NOLMI_DIR="${NOLMI_DIR:-$HOME/nolmi}"
NOLMI_BRANCH="${NOLMI_BRANCH:-main}"
DOMAIN="${DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ─── 1. OS / Grund-Tools ─────────────────────────────────────────────────────
log "1/9  Voraussetzungen prüfen"
case "$(uname -s)" in
  Linux|Darwin) ok "OS: $(uname -s)" ;;
  *) die "Nicht unterstütztes OS '$(uname -s)' — nur Linux/macOS." ;;
esac
command -v git >/dev/null 2>&1 || die "git fehlt — bitte installieren und erneut ausführen."
command -v openssl >/dev/null 2>&1 || die "openssl fehlt — bitte installieren und erneut ausführen."
ok "git + openssl vorhanden"

[ -n "${DOMAIN}" ] || die "DOMAIN fehlt. Aufruf: DOMAIN=deine-domain.tld bash install/install-tls.sh"
ACME_EMAIL="${ACME_EMAIL:-admin@${DOMAIN}}"
ok "DOMAIN=${DOMAIN} · ACME_EMAIL=${ACME_EMAIL}"

# ─── 2. Docker + Compose ─────────────────────────────────────────────────────
log "2/9  Docker prüfen"
if ! command -v docker >/dev/null 2>&1; then
  if [ "$(uname -s)" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then
    warn "Docker nicht gefunden — installiere über get.docker.com (sudo nötig) …"
    curl -fsSL https://get.docker.com | sh
  else
    die "Docker fehlt. macOS: Docker Desktop installieren + starten, dann erneut ausführen."
  fi
fi
docker compose version >/dev/null 2>&1 \
  || die "Docker-Compose-v2-Plugin fehlt (brauche 'docker compose')."
docker info >/dev/null 2>&1 \
  || die "Docker-Daemon nicht erreichbar / keine Rechte (Linux: usermod -aG docker \$USER + neu einloggen)."
ok "Docker + Compose v2 verfügbar"

# ─── 3. DNS-Prereq prüfen (ACME-Challenge braucht erreichbares DNS) ──────────
log "3/9  DNS prüfen (app/runtime/bridge.${DOMAIN})"
resolve_host() {
  if command -v getent >/dev/null 2>&1; then getent hosts "$1" >/dev/null 2>&1 && return 0; fi
  if command -v dig    >/dev/null 2>&1; then [ -n "$(dig +short "$1" 2>/dev/null)" ] && return 0; fi
  if command -v host   >/dev/null 2>&1; then host "$1" >/dev/null 2>&1 && return 0; fi
  if command -v nslookup >/dev/null 2>&1; then nslookup "$1" >/dev/null 2>&1 && return 0; fi
  return 2  # kein DNS-Tool → unbekannt
}
dns_ok=1
for sub in app runtime bridge; do
  h="${sub}.${DOMAIN}"
  if resolve_host "$h"; then ok "DNS ok: ${h}"
  elif [ $? -eq 2 ]; then warn "Kein DNS-Tool (getent/dig/host) — DNS NICHT geprüft für ${h}"; dns_ok=0
  else warn "DNS löst NICHT auf: ${h} — A-Record auf deine Server-IP fehlt?"; dns_ok=0
  fi
done
[ "$dns_ok" = "1" ] || warn "DNS unvollständig — Let's-Encrypt-Cert-Bezug schlägt fehl, solange die 3 A-Records nicht auf diese Maschine zeigen. (Staging-Default mildert das Rate-Limit-Risiko beim Re-Try.)"

# ─── 4. Repo bereitstellen ───────────────────────────────────────────────────
log "4/9  Repo bereitstellen"
if [ -f "package.json" ] && grep -q '"name": "nolmi"' package.json 2>/dev/null \
     && [ -f "docker/nolmi/docker-compose.yml" ]; then
  REPO_ROOT="$(pwd)"
  ok "Im Repo ausgeführt — nutze ${REPO_ROOT}"
elif [ -d "${NOLMI_DIR}/.git" ]; then
  git -C "${NOLMI_DIR}" pull --ff-only || warn "git pull übersprungen — nutze Bestand."
  REPO_ROOT="${NOLMI_DIR}"
  ok "Bestehendes Repo aktualisiert: ${NOLMI_DIR}"
else
  git clone --branch "${NOLMI_BRANCH}" --depth 1 "${NOLMI_REPO_URL}" "${NOLMI_DIR}"
  REPO_ROOT="${NOLMI_DIR}"
  ok "Repo geklont: ${NOLMI_DIR}"
fi
NOLMI_DIR_STACK="${REPO_ROOT}/docker/nolmi"
TRAEFIK_DIR="${REPO_ROOT}/docker/traefik"
[ -f "${NOLMI_DIR_STACK}/docker-compose.yml" ] || die "Prod-Compose fehlt: ${NOLMI_DIR_STACK}/docker-compose.yml"
[ -f "${TRAEFIK_DIR}/docker-compose.yml" ]     || die "Traefik-Compose fehlt: ${TRAEFIK_DIR}/docker-compose.yml"

# ─── 5. Secrets + Nolmi-.env (DOMAIN-abgeleitet, Staging-Default) ─────────────
log "5/9  Secrets + .env"
ENV_FILE="${NOLMI_DIR_STACK}/.env"
if [ -f "${ENV_FILE}" ]; then
  warn ".env existiert bereits (${ENV_FILE}) — Secrets NICHT neu erzeugt (idempotent)."
else
  # Encryption-Key: 32 Byte base64 (= loadMasterKey-Format). Session/Bridge: hex.
  enc_key="$(openssl rand -base64 32)"
  session_secret="$(openssl rand -hex 32)"
  bridge_token="$(openssl rand -hex 32)"
  ( umask 077
    cat > "${ENV_FILE}" <<EOF
# Nolmi TLS-.env — AUTO-GENERIERT von install/install-tls.sh. NICHT committen.
# ⚠ NOLMI_ENCRYPTION_KEY UNBEDINGT SICHERN — verschlüsselt alle API-Keys/OAuth-
#   Tokens in der DB; ohne ihn sind diese Daten unwiederbringlich verloren.

NOLMI_ENCRYPTION_KEY=${enc_key}
NOLMI_SESSION_SECRET=${session_secret}
BRIDGE_REGISTER_TOKEN=${bridge_token}

# Domain (treibt Traefik-Host-Regeln + abgeleitete Werte unten):
DOMAIN=${DOMAIN}
ACME_EMAIL=${ACME_EMAIL}

# TLS-Pflichtwerte:
SESSION_COOKIE_DOMAIN=.${DOMAIN}
SESSION_COOKIE_SECURE=true
ACTIVE_PROVIDER=anthropic

# ACME: Staging-Default (kein Prod-Rate-Limit beim Test). Prod-Flip via
# install/tls-promote.sh, ERST wenn Staging grün ist.
ACME_RESOLVER=le-staging

# Webhook-Modus (Polling aus) → RUNTIME_PUBLIC_URL ist PFLICHT (B2-Befund 2).
TELEGRAM_USE_POLLING=false
RUNTIME_PUBLIC_URL=https://runtime.${DOMAIN}
EOF
  )
  ok ".env erzeugt (${ENV_FILE}) — Secrets NICHT ausgegeben. SICHERE NOLMI_ENCRYPTION_KEY!"
fi

# ─── 6. Images bauen (Web mit DOMAIN-Build-Arg, #126) ────────────────────────
log "6/9  Images bauen (erster Build dauert ein paar Minuten)"
cd "${REPO_ROOT}"
docker build -t nolmi-runtime:latest -f apps/runtime/Dockerfile .
docker build -t nolmi-bridge:latest  -f apps/bridge/Dockerfile  .
# NEXT_PUBLIC_RUNTIME_URL ist BUILD-Zeit (#126) → die EIGENE Domain MUSS hier
# rein. DEPLOYMENT_LABEL=production aktiviert den Build-Guard (echte https-URL
# erzwungen). Es gibt kein vorgebautes Image mit fremder Domain.
docker build -t nolmi-web:latest -f apps/web/Dockerfile . \
  --build-arg NEXT_PUBLIC_RUNTIME_URL="https://runtime.${DOMAIN}" \
  --build-arg NEXT_PUBLIC_DEPLOYMENT_LABEL=production
ok "3 Images gebaut (runtime + bridge + web@${DOMAIN})"

# ─── 7. htpasswd (Node/bcryptjs aus dem Runtime-Image, B2-Befund 1) ──────────
log "7/9  BasicAuth-htpasswd erzeugen"
HTPASSWD_FILE="${TRAEFIK_DIR}/htpasswd"
if [ -f "${HTPASSWD_FILE}" ]; then
  warn "htpasswd existiert bereits (${HTPASSWD_FILE}) — NICHT überschrieben."
else
  bauth_user="${BASICAUTH_USER:-}"
  [ -n "$bauth_user" ] || read -r -p "  BasicAuth-User: " bauth_user
  bauth_pass="${BASICAUTH_PASSWORD:-}"
  if [ -z "$bauth_pass" ]; then
    read -r -s -p "  BasicAuth-Passwort: " bauth_pass; echo
    read -r -s -p "  Passwort wiederholen: " bauth_pass2; echo
    [ "$bauth_pass" = "$bauth_pass2" ] || die "Passwörter stimmen nicht überein."
  fi
  [ -n "$bauth_user" ] && [ -n "$bauth_pass" ] || die "User/Passwort leer."
  # Passwort NUR via ENV an den Container (nicht via argv → keine Prozessliste).
  ( umask 077
    HTPASSWD_USER="$bauth_user" HTPASSWD_PASSWORD="$bauth_pass" \
      docker run --rm -e HTPASSWD_USER -e HTPASSWD_PASSWORD \
        --entrypoint node nolmi-runtime:latest dist/scripts/gen-htpasswd.js \
      > "${HTPASSWD_FILE}"
  )
  [ -s "${HTPASSWD_FILE}" ] || die "htpasswd-Erzeugung fehlgeschlagen (leere Datei)."
  ok "htpasswd erzeugt (${HTPASSWD_FILE}, bcrypt) — Passwort NICHT geloggt."
fi

# ─── 8. Traefik: detect-or-provision ─────────────────────────────────────────
log "8/9  Traefik bereitstellen"
docker network inspect traefik-proxy >/dev/null 2>&1 || docker network create traefik-proxy >/dev/null
if docker ps --format '{{.Names}}' | grep -qx traefik; then
  warn "Vorhandenes Traefik (Container 'traefik') erkannt — NICHT neu aufgesetzt."
  warn "Stelle SELBST sicher: (a) Resolver 'le' UND 'le-staging' sind in DEINER"
  warn "Traefik-Config definiert; (b) die erzeugte htpasswd (${HTPASSWD_FILE}) ist"
  warn "in DEINEM Traefik-Container unter /htpasswd gemountet — sonst liefert"
  warn "app.${DOMAIN} 404 statt 401 (B2-Befund 1)."
else
  # Selbst mitbringen: letsencrypt-Stores + .env + up (traefik:v3.6, beide Resolver).
  mkdir -p "${TRAEFIK_DIR}/letsencrypt"
  for store in acme.json acme-staging.json; do
    [ -f "${TRAEFIK_DIR}/letsencrypt/${store}" ] || : > "${TRAEFIK_DIR}/letsencrypt/${store}"
    chmod 600 "${TRAEFIK_DIR}/letsencrypt/${store}"
  done
  [ -f "${TRAEFIK_DIR}/.env" ] || ( umask 077; printf 'ACME_EMAIL=%s\n' "${ACME_EMAIL}" > "${TRAEFIK_DIR}/.env" )
  ( cd "${TRAEFIK_DIR}" && docker compose up -d )
  ok "Traefik v3.6 gestartet (le + le-staging Resolver, htpasswd gemountet)"
fi

# ─── 9. Nolmi-Stack hochfahren (Staging-ACME) ────────────────────────────────
log "9/9  Nolmi-Stack starten"
( cd "${NOLMI_DIR_STACK}" && docker compose up -d )
ok "Nolmi-Stack gestartet (ACME=le-staging)"

cat <<EOF

  Nolmi läuft mit TLS (Staging-Zertifikate):
    Web:     https://app.${DOMAIN}     (BasicAuth)
    Runtime: https://runtime.${DOMAIN}
    Bridge:  https://bridge.${DOMAIN}

  ⚠ Noch STAGING-Certs (Browser warnt „nicht vertrauenswürdig") — das ist
    gewollt: erst Mechanik prüfen, ohne das Prod-Rate-Limit zu verbrennen.

  Nächste Schritte:
    1) Staging verifizieren (DNS auflösbar, Traefik-Logs sauber, app.${DOMAIN}
       erreichbar mit BasicAuth-401-Prompt).
    2) Auf PROD-Zertifikate flippen (eigener Befehl, B2-Befund 4):
         DOMAIN=${DOMAIN} bash ${REPO_ROOT}/install/tls-promote.sh
    3) Ersten Account anlegen:
         cd "${NOLMI_DIR_STACK}"
         docker compose exec -it nolmi-runtime node dist/scripts/onboard.js
    4) Browser: https://app.${DOMAIN} — einloggen, Wizard führt durch die Twin-Anlage.

  Secret-Backup: ${ENV_FILE} sichern (NOLMI_ENCRYPTION_KEY!).
EOF
