# `docs/specs/drift-recovery/` — Recovery specs for items in `DRIFT.md`

Each folder owns one row from `DRIFT.md`. Folders are numbered so the
file tree reads in dependency-ish order, but they are otherwise
independent — pick any folder and ship it.

| # | Folder | Drift item | TDD entry point |
|---|---|---|---|
| 01 | `01-docker-deployment/` | `infra/` Docker stack on macOS + `NEXT_PUBLIC_*` baking + first-run paths | `tests/compose.contract.test.ts` |
| 02 | `02-package-extraction-agent/` | `@overwatch/agent` is a placeholder | `tests/agent-extraction.test.ts` |
| 03 | `03-package-extraction-ai/` | `@overwatch/ai` is a placeholder | `tests/ai-extraction.test.ts` |
| 04 | `04-package-extraction-cv/` | `@overwatch/cv` is a placeholder | `tests/cv-extraction.test.ts` |
| 05 | `05-package-extraction-ui/` | `@overwatch/ui` is a placeholder | `tests/ui-extraction.test.ts` |
| 06 | `06-fire-detection-classifier/` | `cvWorker.ts` "fire" detector is an edge-density heuristic | `tests/fire-classifier.test.ts` |
| 07 | `07-drone-mobilevit-classifier/` | drone NLI classifier is synthetic; MobileViT XXS not wired | `tests/drone-mobilevit.test.ts` |
| 08 | `08-e2e-playwright-harness/` | no E2E / browser tests anywhere in the repo | `tests/smoke.spec.ts` |
| 09 | `09-handoff-freshness/` | `handoff.md` snapshot header is stale every session | `tests/handoff-freshness.test.ts` |

## Spec contract

Every folder ships:

1. `SPEC.md` — goal, non-goals, scope, public contract, done-when.
2. `TESTS.md` — red-first TDD checklist; each item is one behavior.
3. `tests/` — at least one failing or `.skip`'d test that an
   implementing agent flips green as it works. Tests live with their
   spec, not in the consumer package, so the spec stays self-contained
   until the feature graduates into the workspace.

## Agent rules of engagement

- Work one folder at a time. Don't bundle two specs in one PR.
- TDD: read `SPEC.md`, read `TESTS.md`, then write the failing test
  (or un-skip the scaffold), then the implementation, then re-run
  `pnpm drift && pnpm verify && pnpm test`.
- When the drift is resolved, delete the row from `DRIFT.md` (do not
  flip the status to `RESOLVED` and leave it). Then delete the spec
  folder — the git history is the audit trail.
- If `pnpm drift` still fails after your change, the work is not done.
