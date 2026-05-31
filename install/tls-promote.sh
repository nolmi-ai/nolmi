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
# (acme-staging.json UND acme.json) müssen geleert werden → Traefik-Restart →
# ein Request pro Host als Bezugs-Trigger. Genau das macht dieses Skript.
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

# ─── 2. BEIDE ACME-Stores leeren (B2-Befund 4, VM-verifiziert Tag 33) ─────────
# Tiefer als ursprünglich dokumentiert: NUR acme-staging.json zu leeren reicht
# NICHT. Traefik registriert dann zwar einen le-Prod-ACME-Account (acme.json =
# Account-only, KEINE Certs), serviert aber WEITER das Staging-Cert — solange
# für die Domains irgendein Cert existiert (Staging-Store neu gefüllt +
# in-memory), sieht Traefik "kein Bezugsbedarf". Beide Stores müssen leer sein.
# Reihenfolge entscheidend: BEIDE leeren → Restart (lädt leere Stores, kein Cert
# zum Matchen) → Trigger (Schritt 4) erzwingt Neu-Bezug gegen le (Prod).
#
# TRADE-OFF: acme.json mitzuleeren wirft auch den Prod-ACME-Account weg → bei
# JEDEM Flip neuer Account + frischer Bezug. Für den EINMALIGEN Staging→Prod-
# Flip unkritisch (Account-Anlage ist gratis, kein Rate-Limit darauf). Wer je
# WIEDERHOLT flippt, sollte das bedenken.
log "2/4  BEIDE ACME-Stores leeren + Traefik neustarten"
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

# ─── 3. Nolmi-Stack recreaten (neues certresolver=le-Label greift) ───────────
log "3/4  Nolmi-Stack neu erstellen (Label certresolver=le aktiv)"
( cd "${NOLMI_DIR_STACK}" && docker compose up -d --force-recreate )
ok "Stack neu erstellt"

# ─── 4. Bezugs-Trigger + Verify ──────────────────────────────────────────────
log "4/4  Cert-Bezug triggern + verifizieren (~30–90 s)"
for sub in app runtime bridge; do
  curl -k -s -o /dev/null --max-time 20 "https://${sub}.${DOMAIN}/" || true
done
sleep 5
all_prod=1
for sub in app runtime bridge; do
  h="${sub}.${DOMAIN}"
  issuer="$(echo | openssl s_client -connect "${h}:443" -servername "${h}" 2>/dev/null \
            | openssl x509 -noout -issuer 2>/dev/null || true)"
  if [ -z "${issuer}" ]; then
    warn "${h}: noch kein Cert lesbar — ACME läuft evtl. noch (in ~1 min erneut prüfen)."; all_prod=0
  elif echo "${issuer}" | grep -qi "STAGING"; then
    warn "${h}: noch STAGING-Issuer (${issuer}) — Bezug evtl. noch nicht durch."; all_prod=0
  else
    ok "${h}: PROD-Issuer (${issuer})"
  fi
done

if [ "${all_prod}" = "1" ]; then
  cat <<EOF

  ✓ Prod-Zertifikate aktiv über app/runtime/bridge.${DOMAIN}.
    Browser sollte keine TLS-Warnung mehr zeigen.
EOF
else
  cat <<EOF

  ! Noch nicht alle Hosts auf Prod-Issuer. ACME braucht manchmal 1–2 min.
    Erneut prüfen:
      for h in app runtime bridge; do
        echo | openssl s_client -connect \$h.${DOMAIN}:443 -servername \$h.${DOMAIN} 2>/dev/null \\
          | openssl x509 -noout -issuer
      done
    Bleibt STAGING kleben: Traefik-Logs prüfen (--since 5m) + acme-staging.json wirklich leer?
EOF
fi
