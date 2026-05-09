# MCP-Server-Specs

Per-Twin MCP-Server-Konfigurationen. Werden via
`pnpm twin:mcp-add <handle> <spec-file>` registriert. Pro Server ein File,
sprechende Dateinamen.

## Spec-Format

| Feld                        | Pflicht       | Beschreibung                                                                                                            |
| --------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `name`                      | ja            | Server-Bezeichner. UNIQUE pro Twin. Erscheint als Präfix im Skill-Naming (`mcp:<name>:<tool>`).                          |
| `transport`                 | ja            | `"stdio"` oder `"http"`. In 3.2 nur `stdio` aktiv; `http` wird vom McpClientManager noch nicht gespawnt.                 |
| `command`                   | bei stdio     | Executable, z.B. `"npx"` oder ein absoluter Pfad.                                                                        |
| `args`                      | optional      | String-Array mit Command-Args.                                                                                          |
| `url`                       | bei http      | Full URL des HTTP-MCP-Endpoints.                                                                                        |
| `env`                       | optional      | Object mit ENV-Vars für den Subprocess. Wert `"?"` löst eine interaktive Eingabe beim `mcp-add` aus (Password-Style).   |
| `defaultRequiresApproval`   | optional      | `true`/`false`. Default `true`. Steuert den Server-weiten Approval-Default für die zugehörigen Skill-Manifests.         |

## Beispiele

`everything.json` — der offizielle Demo-Server. Kein ENV nötig, harmlose Tools
(echo, add, longRunningOperation, …). Ist der Pilot-Setup für `@markus`.

```json
{
  "name": "everything",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-everything"],
  "defaultRequiresApproval": false
}
```

Server mit ENV-Secret (Pattern):

```json
{
  "name": "github",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_TOKEN": "?" },
  "defaultRequiresApproval": true
}
```

`"GITHUB_TOKEN": "?"` triggert beim `mcp-add` einen verdeckten Prompt
("GITHUB_TOKEN: "). Der eingegebene Wert wird verschlüsselt (AES-256-GCM,
Master-Key aus `TWIN_LAB_ENCRYPTION_KEY`) in `mcp_servers.env_json_encrypted`
abgelegt.

## CLI-Lifecycle

```bash
pnpm twin:mcp-add @markus mcp-servers/everything.json
pnpm twin:mcp-list @markus
pnpm twin:mcp-list @markus --json
pnpm twin:mcp-refresh @markus everything
pnpm twin:mcp-remove @markus everything --yes
```
