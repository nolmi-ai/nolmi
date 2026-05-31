#!/usr/bin/env bash
#
# ─── NOLMI TLS-PROMOTE: Staging → Prod-Zertifikate (Distribution 3b) ──────────
#
# Flippt den ACME-Resolver von `le-staging` auf `le` (echte Let's-Encrypt-Certs).
# BEWUSST ein getrennter, manuell aufzurufender Befehl — NICHT Teil von
# install-tls.sh. Erst ausführen, NACHDEM Staging grün verifiziert ist.
#
# WARUM Staging zuerst: Let's Encrypt hat ein striktes Prod-Rate-Limit
# (Certs pro Domain/Woche). Wer beim Einrichten gegen Prod testet und Fehler
# macht, verbrennt das Kontingent und sperrt sich für Tage aus. Staging hat
# kein scharfes Limit → erst Mechanik beweisen, dann einmal sauber flippen.
#
# WARUM dieser Befehl nötig ist (§7 B2-Befund 4, VM-verifiziert Tag 33): Nur
# `ACME_RESOLVER` umzustellen reicht NICHT — Traefik matcht vorhandene Certs nach
# DOMAIN, nicht nach Resolver, und liefert weiter Staging, solange für die Domain
# irgendein Cert existiert. Und tiefer als ursprünglich dokumentiert: NUR den
# Staging-Store zu leeren reicht AUCH nicht — der le-Prod-Resolver legt dann nur
# einen Account an (acme.json = Account-only), bezieht aber keine Certs, weil der
# neu gefüllte Staging-Store „kein Bezugsbedarf" signalisiert. BEIDE Stores
# (acme-staging.json UND acme.json) müssen geleert werden.
#
# Und die REIHENFOLGE ist entscheidend (VM-Gegentest Tag 33): erst den Stack auf
# das le-Label recreaten (le durchgängig aktiv), DANN beide Stores leeren +
# Traefik-Restart, DANN triggern. Sonst entsteht zwischen Store-Reset und
# Stack-Recreate ein Fenster, in dem die Stores leer sind, der Stack aber noch
# auf dem le-staging-Label steht → ein Bezug zieht wieder Staging. Ablauf also:
#   (1) .env→le  (2) Stack-Recreate (le-Label)  (3) beide Stores leeren+Restart
#   (4) Trigger/Verify. Genau das macht dieses Skript.
#
#   DOMAIN=deine-domain.tld bash install/tls-promote.sh

set -euo pipefail

DOMAIN="${DOMAIN:-}"
NOLMI_DIR="${NOLMI_DIR:-$HOME/nolmi}"

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "${DOMAIN}" ] || die "DOMAIN fehlt. Aufruf: DOMAIN=deine-domain.tld bash install/tls-promote.sh"

# Repo-Root finden (in-repo oder Clone)
if [ -f "package.json" ] && grep -q '"name": "nolmi"' package.json 2>/dev/null \
     && [ -f "docker/nolmi/docker-compose.yml" ]; then
  REPO_ROOT="$(pwd)"
elif [ -d "${NOLMI_DIR}/.git" ]; then
  REPO_ROOT="${NOLMI_DIR}"
else
  die "Kein Nolmi-Repo gefunden (weder hier noch unter ${NOLMI_DIR})."
fi
NOLMI_DIR_STACK="${REPO_ROOT}/docker/nolmi"
TRAEFIK_DIR="${REPO_ROOT}/docker/traefik"
ENV_FILE="${NOLMI_DIR_STACK}/.env"
[ -f "${ENV_FILE}" ] || die "Nolmi-.env fehlt (${ENV_FILE}) — zuerst install-tls.sh."

log "Sicherheits-Check"
warn "Dieser Flip fordert ECHTE Let's-Encrypt-Zertifikate an (Prod-Rate-Limit gilt)."
warn "Voraussetzung: Staging läuft, DNS auflösbar, app/runtime/bridge.${DOMAIN} erreichbar."
read -r -p "  Fortfahren? (yes/NEIN): " confirm
[ "$confirm" = "yes" ] || die "Abgebrochen."

# ─── 1. ACME_RESOLVER auf le setzen ──────────────────────────────────────────
log "1/4  ACME_RESOLVER → le (in ${ENV_FILE})"
if grep -qE '^ACME_RESOLVER=' "${ENV_FILE}"; then
  # portabel (macOS/Linux): über temp-Datei statt sed -i
  tmp="$(mktemp)"; sed 's/^ACME_RESOLVER=.*/ACME_RESOLVER=le/' "${ENV_FILE}" > "$tmp" && mv "$tmp" "${ENV_FILE}"
else
  printf 'ACME_RESOLVER=le\n' >> "${ENV_FILE}"
fi
ok "ACME_RESOLVER=le gesetzt"

# ─── 2. Stack-Recreate ZUERST — le-Label durchgängig aktiv (Reihenfolge-Fix) ──
# REIHENFOLGE ist entscheidend (VM-Gegentest Tag 33): der Stack-Recreate (neues
# certresolver=le-Label) muss VOR dem Store-Reset laufen. Sonst entsteht zwischen
# Store-Reset und Recreate ein Fenster, in dem Traefik mit LEEREN Stores läuft,
# der Stack aber noch das ALTE le-staging-Label trägt → ein Bezug in diesem
# Fenster geht wieder gegen Staging (genau der Gegentest-Befund: acme.json leer,
# acme-staging.json voll, alle Hosts STAGING). le erst am Stack aktiv machen,
# DANN die Stores leeren — kein Staging-Fenster mehr.
log "2/4  Nolmi-Stack neu erstellen (Label certresolver=le aktiv, BEVOR Stores angefasst werden)"
( cd "${NOLMI_DIR_STACK}" && docker compose up -d --force-recreate )
ok "Stack neu erstellt — le-Label durchgängig aktiv"

# ─── 3. BEIDE ACME-Stores leeren (B2-Befund 4, VM-verifiziert Tag 33) ─────────
# NUR acme-staging.json zu leeren reicht NICHT: der le-Prod-Resolver legt dann
# nur einen Account an (acme.json = Account-only, KEINE Certs), serviert aber
# WEITER das Staging-Cert — solange für die Domains irgendein Cert existiert
# (Staging-Store neu gefüllt + in-memory), sieht Traefik "kein Bezugsbedarf".
# Beide Stores müssen leer sein. Da der Stack (Schritt 2) bereits durchgängig auf
# le steht, kann der folgende Restart/Trigger keinen Staging-Bezug mehr auslösen.
#
# TRADE-OFF: acme.json mitzuleeren wirft auch den Prod-ACME-Account weg → bei
# JEDEM Flip neuer Account + frischer Bezug. Für den EINMALIGEN Staging→Prod-
# Flip unkritisch (Account-Anlage ist gratis, kein Rate-Limit darauf). Wer je
# WIEDERHOLT flippt, sollte das bedenken.
log "3/4  BEIDE ACME-Stores leeren + Traefik neustarten"
STAGING_STORE="${TRAEFIK_DIR}/letsencrypt/acme-staging.json"
PROD_STORE="${TRAEFIK_DIR}/letsencrypt/acme.json"
if [ -f "${STAGING_STORE}" ] || [ -f "${PROD_STORE}" ]; then
  for store in "${STAGING_STORE}" "${PROD_STORE}"; do
    : > "${store}"          # create-or-truncate
    chmod 600 "${store}"
    ok "geleert: ${store}"
  done
  if [ -f "${TRAEFIK_DIR}/docker-compose.yml" ] && docker ps --format '{{.Names}}' | grep -qx traefik; then
    ( cd "${TRAEFIK_DIR}" && docker compose restart )
    ok "Traefik neugestartet (lädt leere Stores → kein Cert zum Matchen)"
  else
    warn "Traefik-Stack nicht hier verwaltet — starte DEIN Traefik selbst neu."
  fi
else
  warn "Keine verwalteten ACME-Stores gefunden (externes Traefik?)."
  warn "Leere SELBST acme-staging.json UND acme.json deiner Traefik-Instanz + Restart"
  warn "(BEIDE Stores, nicht nur Staging — B2-Befund 4), sonst bleibt Staging kleben."
fi

# ─── 4. Bezugs-Trigger + Verify ──────────────────────────────────────────────
log "4/4  Cert-Bezug triggern + verifizieren (~30–90 s)"
for sub in app runtime bridge; do
  curl -k -s -o /dev/null --max-time 20 "https://${sub}.${DOMAIN}/" || true
done
# Ein echtes Prod-Cert erfüllt ALLE drei: enthält "Let's Encrypt", NICHT "STAGING",
# NICHT "TRAEFIK DEFAULT CERT". Letzteres ist Traefiks Platzhalter VOR dem Bezug —
# der wurde fälschlich als Erfolg gewertet (VM-Befund Tag 33). Retry, weil ACME
# nach dem Trigger ~30–90 s braucht; bis zu 6×15 s = 90 s.
issuer_state() { # → "prod" | "staging" | "default" | "none"
  local h="$1" iss
  iss="$(echo | openssl s_client -connect "${h}:443" -servername "${h}" 2>/dev/null \
         | openssl x509 -noout -issuer 2>/dev/null || true)"
  if [ -z "${iss}" ]; then echo "none"; return; fi
  if echo "${iss}" | grep -qi "STAGING"; then echo "staging"; return; fi
  if echo "${iss}" | grep -qi "TRAEFIK DEFAULT CERT"; then echo "default"; return; fi
  if echo "${iss}" | grep -qi "Let's Encrypt"; then echo "prod"; return; fi
  echo "default" # unbekannter Issuer → nicht als Erfolg werten
}

all_prod=0
for attempt in 1 2 3 4 5 6; do
  all_prod=1
  for sub in app runtime bridge; do
    h="${sub}.${DOMAIN}"
    case "$(issuer_state "${h}")" in
      prod)    : ;; # ok — wird nach der Schleife gesammelt gemeldet
      staging) all_prod=0 ;;
      default) all_prod=0 ;;
      none)    all_prod=0 ;;
    esac
  done
  [ "${all_prod}" = "1" ] && break
  if [ "${attempt}" -lt 6 ]; then
    warn "Bezug noch nicht durch (Versuch ${attempt}/6) — warte 15 s …"
    sleep 15
  fi
done

if [ "${all_prod}" = "1" ]; then
  for sub in app runtime bridge; do ok "${sub}.${DOMAIN}: PROD-Issuer (Let's Encrypt)"; done
  cat <<EOF

  ✓ Prod-Zertifikate aktiv über app/runtime/bridge.${DOMAIN}.
    Browser sollte keine TLS-Warnung mehr zeigen.
EOF
else
  cat <<EOF

  ! Nach ~90 s noch nicht alle Hosts auf echten Prod-Certs (Let's Encrypt, kein
    STAGING / kein "TRAEFIK DEFAULT CERT"). ACME kann länger brauchen.
    Manuell prüfen:
      for h in app runtime bridge; do
        echo | openssl s_client -connect \$h.${DOMAIN}:443 -servername \$h.${DOMAIN} 2>/dev/null \\
          | openssl x509 -noout -issuer
      done
    Default-Cert klebt: Traefik-Logs (--since 5m) auf le-Bezugsfehler prüfen.
    Staging klebt: acme-staging.json wirklich leer? le-Label am Stack aktiv?
EOF
fi
