# 09 — Handoff freshness

## Goal

`handoff.md` is the agent on-boarding contract, and its header
("Local main: `<sha>`, working tree: clean, tests N/N pass") is stale
within a session. Either keep it fresh mechanically or strip the
volatile bits.

## Non-goals

- Replacing `handoff.md`'s narrative sections. Those are durable and
  useful.
- Auto-generating the whole file. The narrative is human-curated.

## Options

### Option A — strip the volatile header

Delete the `Last updated / Local main / Tests / Working tree` block.
Replace with a one-liner: *"Run `git log -1 --oneline && pnpm test`
to see current state."* Drift goes away because the claim goes away.

### Option B — auto-refresh on commit

`scripts/refresh-handoff-header.ts` regenerates the header from `git
log -1` and the last cached test count. Hook via `pre-commit`
(`lefthook` or `husky`). Header always matches `HEAD`.

### Option C — split it

Move the volatile header to `handoff.status` (machine-generated, in
`.gitignore`, refreshed by a script) and keep `handoff.md` purely
narrative.

Pick **A** unless someone has a strong reason for B/C. A is the
fewest-moving-parts option and matches the agent baseline's
"preserve working state, fewer moving parts" doctrine.

## Done-when

- `handoff.md` no longer asserts SHA/test/tree facts that can rot.
- `DRIFT.md §6.1` row deleted.
- The narrative sections (§2 commit history, §3 architectural state,
  etc.) are reviewed for drift in the same pass and updated.

## Risks

- Option B / C add a new failure surface (a pre-commit hook that
  could block commits in unusual states). Option A has none.
