# Twin-Lab

**Self-hosted AI twins that remember, have personality, and talk to each other.**

![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)
![Status](https://img.shields.io/badge/status-pre--launch-orange.svg)
![Built with Claude](https://img.shields.io/badge/built_with-Claude-D97757.svg)

---

<!-- HERO-GIF PLACEHOLDER -->
<!-- Hero-GIF: 60s end-to-end walkthrough — coming in #113 -->
<!-- Will live at: docs/hero.gif (or similar) -->

> **📹 Demo video coming soon** — a 60-second walkthrough showing twin creation, conversation, memory recall, and twin-to-twin handoff.

---

## What is Twin-Lab

Twin-Lab is a self-hosted platform for personal AI twins. Unlike chat assistants
that forget you between sessions, each twin carries persistent memory, an
individual persona, and the ability to communicate with other twins on the same
instance — yours or someone else's.

You run it on your own server. Your conversations, your API keys, your data
stay with you.

## Why Twin-Lab

- **🧠 Memory depth** — twins remember conversations across sessions, surface
  relevant context automatically, and reach a "maturity" the longer they're used
- **🎭 Persona** — each twin has a defined identity, communication style, and
  topical interests editable via UI or YAML
- **🔗 Twin-to-twin communication** — twins can talk to each other directly via
  the built-in A2A-Bridge, with owner approval for each interaction
- **🔎 Research workflow (beta)** — twins can autonomously search and synthesize
  web content via MCP-connected browser tools

## Quick Start

```bash
# Clone
git clone https://github.com/markusbaier/twin-lab.git
cd twin-lab

# Install dependencies
pnpm install

# Configure
cp .env.example .env
# Edit .env:
#   ACTIVE_PROVIDER=anthropic
#   ANTHROPIC_API_KEY=sk-ant-...

# Initialize database
pnpm db:init

# Run
pnpm dev

# Open http://localhost:3000 and follow the onboarding wizard
```

**Requirements:** Node ≥20, pnpm ≥9, and an Anthropic API key.

For production self-hosting with HTTPS, custom domain, and backups,
see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Screenshots

| | |
|:---:|:---:|
| ![Onboarding Wizard](docs/screenshots/onboarding-wizard.png) | ![Chat with Maturity Badge](docs/screenshots/chat-maturity.png) |
| *Onboarding Wizard — first-time twin setup* | *Chat with maturity badge — twins develop over time* |
| ![A2A Conversation](docs/screenshots/a2a-conversation.png) | ![Settings](docs/screenshots/settings.png) |
| *A2A Conversation — twins talking to each other* | *Settings — persona, LLM, presets editable per twin* |

## Status & Beta

Twin-Lab is in **Pre-Launch Phase A** (self-hosting). It's stable enough to use
daily but not yet hardened for public deployment.

**Works today**
- Memory-rich conversations with persistent context
- Per-twin persona definition (UI + YAML)
- Twin-to-twin communication via A2A-Bridge
- Onboarding wizard for first-time setup
- Docker-based self-hosting

**Beta**
- Research workflow via Hyperbrowser MCP — works, but expect rough edges
- Some computer-use patterns are intentionally out of scope for Phase A

**Coming in Phase B**
- SaaS-hosting (managed deployment)
- Mobile integration (Telegram, WhatsApp)
- Conversational skill and tool installation — telling your twin "install the calendar integration" instead of using a settings UI

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full roadmap.

## Tech Stack

- **Frontend** — Next.js 15 (App Router) + React 19
- **Runtime** — Fastify 5 + Vercel AI SDK v6
- **Database** — SQLite via better-sqlite3 11
- **Model** — Claude Opus 4.7 via Anthropic API (`@ai-sdk/anthropic` 3)
- **Deployment** — Docker Compose + Traefik

## Roadmap

Twin-Lab is currently in **Pre-Launch Phase A** — self-hosting launch.
**Phase B** brings SaaS-hosting and mobile integration. See
[docs/ROADMAP.md](docs/ROADMAP.md) for details.

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines
and [docs/BACKLOG.md](docs/BACKLOG.md) for what's planned.

## License

Apache 2.0 — see [LICENSE](LICENSE).
