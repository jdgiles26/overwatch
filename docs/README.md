# `docs/` — project documentation index

Browse here first. Authoritative architecture docs live in the root
of the repo (`README.md`, `AGENTS.md`, `CLAUDE.md`); this directory
holds *deeper-dive* docs, feature inventories, plans, and specs.

| File / dir | Read when |
|---|---|
| `FEATURES.md` | You need to know which file/test backs a user-facing feature, or you're adding a new feature that needs to be inventoried |
| `drone-detection-readme.md` | You're touching the drone-RF pipeline or aggregator |
| `plans/` | You're picking up a planned-but-unstarted feature — each plan is dated and self-contained |
| `specs/` | You need the formal spec for a feature (deeper than the plan) |
| `assets/` | Static images / diagrams referenced from other docs |

## Where the *other* canonical docs live

| Doc | Location | Purpose |
|---|---|---|
| Root README | `/README.md` | Quickstart + product overview |
| Agent guardrails | `/.agents/BASELINE.md` | Hard rules for AI coding agents working in this repo |
| Architecture | `/AGENTS.md` | Tech stack, monorepo structure, conventions |
| Project-specific Claude rules | `/CLAUDE.md` | Claude Code specific commands & conventions |
| Per-package READMEs | `/apps/*/README.md`, `/packages/*/README.md` | Folder-scoped documentation |
| Future ideas / roadmap | `/future/IDEAS.md` | Forward-looking enhancement list |

## Adding new docs

- Plans go in `plans/` named `YYYY-MM-DD-<slug>.md`
- Specs go in `specs/` with the same naming
- Cross-link from `FEATURES.md` when a doc maps to a tracked feature
- Update this index when you add a new top-level doc
