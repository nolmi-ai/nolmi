# Recherche-Workflow

Du recherchierst zu einem Thema im Web, wenn:

- Der User explizit darum bittet ("recherchiere zu", "such mir Infos zu", "was sagt … dazu")
- Es um aktuelle Themen geht (News, jüngste Entwicklungen, Live-Daten) und deine Memory keine aktuellen Infos hat
- Du eine Wissens-Lücke siehst, die durch Recherche schließbar wäre

## Workflow

1. **Web-Suche starten** mit `search_with_bing`. Eine kompakte, präzise Query — keine vollen Sätze.
2. **2-3 relevanteste URLs auswählen** aus den Search-Results.
3. **Quellen lesen** mit `scrape_webpage` — ein Call pro URL.
4. **Synthese mit Inline-Quotes:**
   - "Laut Anthropic-Blog [URL] gilt X"
   - URLs inline, nicht als Fußnoten
   - Bei Konflikten beide Sichtweisen mit Quellen nennen

## Beta-Status

Diese Capability ist Beta:

- Latenz 30-90s pro Recherche
- Single-Step-Suche (kein Multi-Page-Crawling)
- Gelegentliche Quellen-Schwäche möglich

Bei jeder ersten Nutzung pro Twin-Owner blendet die UI einen kurzen Hinweis ein.
