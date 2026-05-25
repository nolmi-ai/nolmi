# Contributing to Twin-Lab

Thanks for your interest in contributing! Twin-Lab is in **Pre-Launch Phase A**
(self-hosting launch), so the codebase is moving fast and the contribution
process is still light-touch. This document explains how to help.

## Before You Open a PR

For anything beyond typo fixes or small doc improvements, please **open an
issue first** to discuss the change. This avoids throwaway work — the
roadmap is opinionated and not every reasonable idea fits the current phase.

See `docs/BACKLOG.md` for what's planned and `docs/ROADMAP.md` for where
things are heading.

## Development Setup

See `docs/SETUP.md` for local development and `docs/DEPLOYMENT.md` for
self-hosting.

## Code Style

- TypeScript strict mode, no `any` unless justified
- Run `pnpm lint` before submitting
- Run `pnpm typecheck` before submitting
- New logic: include tests where reasonable

## How We Work

Twin-Lab is built in a tight pair-programming loop:

1. **Diagnose first** — read the relevant code, find the actual shape of the
   problem, then propose a plan. Briefings often need adjustment once the
   code-reality is checked.
2. **Small commits, walkthrough loops** — each section reviewed before
   moving on. Long-form changes get multiple walkthrough rounds.
3. **Document as you go** — `docs/STAND.md` is the running log,
   `docs/BACKLOG.md` is the queue.

External contributors don't need to follow this verbatim, but PRs that come
with diagnosis notes and small commits are easier to review.

## Pre-push build check

Twin-Lab runs `pnpm build` as a pre-push hook (via Husky) to catch
production-build issues that don't show up during `pnpm dev`. Common
examples: Next.js static-generation errors like `useSearchParams()`
outside a Suspense boundary.

The hook runs automatically on `git push`. If the build fails, fix the
issue or skip the hook with:

```bash
git push --no-verify
```

Use `--no-verify` for WIP/backup pushes and documentation-only commits
where the build won't be affected. For code changes touching `apps/`,
don't skip.

## Pull Request Guidelines

- Reference the related issue in the PR body
- Include smoke-test output if your change touches runtime behavior
- Keep PRs focused — split large changes into reviewable chunks
- English preferred for issues, PRs, and commit messages

## Code of Conduct

Be kind. No harassment, no discrimination. Disagreement is fine, dismissive
behavior is not. English preferred for public communication so everyone can
follow along.

If something goes wrong, email markus.baier@harwayexperience.com.

## Questions

Use the **Question** issue template for usage questions or unclear behavior.
For security issues, see `SECURITY.md`.
