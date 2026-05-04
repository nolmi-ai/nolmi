# twin-lab-web — Production-Setup

Deploy-Sequenz für `app.twin.harwayexperience.com` +
`runtime.twin.harwayexperience.com` auf VPS srv1046432.

## Vorbedingungen

- DNS-Records für `app.*` und `runtime.*` zeigen auf VPS-IP (verifiziert 04.05)
- Bridge läuft unter `bridge.twin.harwayexperience.com` (#45)
- `traefik-proxy` Docker-Network existiert (durch Bridge angelegt)
- Repo via Deploy-Key klonbar (#64)

## Setup (einmalig)

1. Verzeichnis anlegen:

   ```
   mkdir -p /docker/twin-lab-web
   cd /docker/twin-lab-web
   ```

2. Repo klonen:

   ```
   git clone git@github.com-twin-lab:markusbaier/twin-lab.git repo
   ```

3. `.env` aus `.env.example` schreiben mit Production-Werten:

   ```
   cp repo/docker/twin-lab-web/.env.example .env
   $EDITOR .env
   ```

4. Compose-Symlink setzen (`.env` bleibt eigene Datei in `/docker/twin-lab-web/`):

   ```
   ln -s repo/docker/twin-lab-web/docker-compose.yml docker-compose.yml
   ```

5. Images bauen (aus Repo-Root, nicht aus `docker/twin-lab-web/`):

   ```
   cd repo
   docker build -t twin-lab-runtime:latest -f apps/runtime/Dockerfile .
   docker build \
     -t twin-lab-web:latest \
     -f apps/web/Dockerfile \
     --build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.twin.harwayexperience.com \
     .
   cd ..
   ```

6. Runtime allein hochfahren (DB-Init):

   ```
   docker compose up -d runtime
   docker compose exec runtime node dist/scripts/init-db.js
   ```

7. Verifikation Runtime:

   ```
   curl -i https://runtime.twin.harwayexperience.com/health
   ```

8. Web dazustarten:

   ```
   docker compose up -d web
   ```

9. Verifikation Web:

   ```
   curl -i https://app.twin.harwayexperience.com/
   ```

   (Erwartet: 200 oder 307 Redirect zu `/login`)

10. User anlegen für markus, florian, heiko:

    ```
    docker compose exec runtime node dist/scripts/create-user.js
    ```

    (interaktiv, dreimal ausführen)

11. Browser: `app.twin.harwayexperience.com/onboarding` —
    Pro User einloggen, Twin onboarden mit Production-Bridge-URL
    (kommt aus ENV-Default automatisch)

12. Smoke-Test: Login als markus, Chat mit eigenem Twin, A2A-Send
    an florian

## Image-Rebuild bei Code-Updates

```
cd /docker/twin-lab-web/repo
git pull
docker build -t twin-lab-runtime:latest -f apps/runtime/Dockerfile .
docker build \
  -t twin-lab-web:latest \
  -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.twin.harwayexperience.com \
  .
cd ..
docker compose up -d
```
