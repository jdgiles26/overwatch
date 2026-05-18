# Agentic Coding Baseline — Strict Guardrails

> **Version:** 2026-05  
> **Scope:** All AI coding agents operating in the OverWatch repository  
> **Authority:** This document overrides generic agent instructions when conflicts arise. Project-specific rules in `AGENTS.md` and deeper `AGENTS.md` files override this baseline.

---

## 1. Prime Directive

**Preserve working state. Make minimal changes. Verify everything.**

Every action must be reversible or safely bounded. An agent that cannot explain *why* a change was made should not make it.

---

## 2. Pre-Flight Checklist (Mandatory Before Any Code Change)

Complete all steps before writing, editing, or deleting code:

1. **Read `AGENTS.md`** — Check the root and any nested `AGENTS.md` files in directories you will touch. Do not assume generic conventions apply.
2. **Read the target code** — You must read every file you intend to modify. No exceptions. If you do not understand a file, ask.
3. **Read co-located tests** — Identify `*.test.ts` files adjacent to your targets. Understand the test contract before changing implementations.
4. **Check the dependency graph** — Use `grep` or read imports to identify callers of functions you plan to change.
5. **Determine planning requirement** — See §3. If plan mode is required, enter it before proceeding.
6. **State your assumptions** — If you are inferring intent from incomplete context, state the inference explicitly.

---

## 3. Planning Gates

Planning is **mandatory** for the following scenarios. Use `EnterPlanMode` → `ExitPlanMode`.

| Scenario | Gate Requirement |
|---|---|
| New feature implementation | Plan required |
| Refactoring public APIs or shared types | Plan required |
| Changes touching ≥3 files | Plan required |
| Database schema or migration | Plan + rollback strategy required |
| Changes to encryption, auth, or security-critical paths | Plan + explicit user approval required |
| Modifications to CI/build infrastructure | Plan required |
| Changes to `packages/*` used by multiple apps | Plan required |

Planning is **optional but recommended** for:
- Bug fixes with unclear root cause
- Performance optimizations
- UI component additions

**Plan contents must include:**
1. Files to be read (already done in pre-flight)
2. Files to be modified, created, or deleted
3. Interface changes and their blast radius
4. Test strategy (what to add, what must still pass)
5. Verification commands to run post-implementation

---

## 4. The Read-First Protocol

### 4.1 Prohibited Actions
- **Do not edit a file you have not read** in the current session.
- **Do not delete code you cannot explain.** Commenting out is preferred over deletion during exploration.
- **Do not modify tests** unless the public interface actually changed. If the interface changed, tests *must* be updated.
- **Do not use `any` to bypass type errors.** Fix the underlying type issue. (`any` is only permitted at boundaries with untyped third-party libraries, per project ESLint config.)

### 4.2 Exploration Rules
- For searches spanning >3 queries or multiple modules, use `Agent(subagent_type="explore")`.
- Launch multiple explore agents concurrently for independent questions.
- Never guess file paths. Use `Glob` or `Shell` (`find`, `ls`) to confirm.

---

## 5. Implementation Guardrails

### 5.1 Change Discipline
- **One logical change per task.** Do not combine unrelated fixes, refactors, and features in a single pass.
- **Minimal diff principle.** Prefer small, targeted edits over rewrites. If a file requires >50% changes, stop and plan.
- **Preserve existing behavior** unless explicitly instructed otherwise. Bug fixes are the exception.

### 5.2 TypeScript & Code Quality
- Strict mode is non-negotiable. The project enables `strict`, `noUncheckedIndexedAccess`, and ES modules.
- All new public functions must have explicit return types.
- All new modules must be `.ts` (backend/util) or `.tsx` (React).
- Do not add `@ts-ignore` or `@ts-expect-error` without a comment explaining why it is unavoidable.

### 5.3 Monorepo Hygiene
- Use workspace aliases for cross-package imports (`@overwatch/schemas`, `@overwatch/connectors`).
- Use `@/*` only for intra-app imports in `apps/web`.
- Never use relative path traversal (`../../`) across package boundaries.
- Placeholder packages (`packages/agent`, `packages/ai`, `packages/cv`, `packages/ui`) are **off-limits** unless you have updated their `package.json` and build infrastructure.

### 5.4 Testing Requirements
- Every new non-trivial function gets a co-located test: `foo.ts` → `foo.test.ts`.
- Run existing tests **before** your change to establish baseline (they should pass).
- Run affected tests **after** your change.
- If you modified a package with tests, run the full package test suite:
  ```bash
  pnpm --filter @overwatch/<name> test
  ```
- If you broke a test, fix it. Do not delete or disable tests to make CI pass.

### 5.5 UI & Client-Side Code
- Components using browser APIs (WebSocket, Web Workers, Cesium, MapLibre) **must** be `"use client"`.
- Follow the tactical color palette in `tailwind.config.ts`. Do not introduce arbitrary hex codes.
- Test UI changes visually when possible (build and check the browser).

---

## 6. Verification Protocol

Before declaring a task complete, run the appropriate verification ladder:

### 6.1 Code Changes
```bash
# 1. Typecheck the affected package(s)
pnpm --filter @overwatch/<name> typecheck

# 2. Run tests for affected package(s)
pnpm --filter @overwatch/<name> test

# 3. Run linter (web only)
pnpm --filter @overwatch/web lint

# 4. Full verification (if broadly affected)
pnpm verify
```

### 6.2 Database / Encryption Changes
- Verify `better-sqlite3` migrations run cleanly.
- Confirm `key.bin` and `overwatch.db` logic remains backward-compatible.
- Do not commit `overwatch.db` or `key.bin`.

### 6.3 Connector Changes
- If you added or modified a connector, validate it against the schema in `packages/schemas`.
- Ensure the connector is exported in `packages/connectors/src/index.ts`.
- Test parsing logic with unit tests.

### 6.4 Smoke Test (Drone / Integration)
If your changes touch the drone pipeline, orchestrator, alerts, or WebSocket broadcast:
```bash
# Terminal 1: start fabric
pnpm --filter @overwatch/fabric dev

# Terminal 2: run smoke test
pnpm tsx scripts/smoke-drone.ts
```

---

## 7. Safety & Security Rules

### 7.1 File System
- **Never** modify files outside the working directory (`/Users/joshua.giles/Projects/overwatch/`).
- **Never** run `rm -rf` on source directories. Use targeted `rm` for specific generated files only.
- **Never** overwrite `.env` files directly. Use `.env.example` as a template and instruct the user to update `.env` manually.

### 7.2 Git
- **Do not** run `git commit`, `git push`, `git reset`, `git rebase`, `git merge`, or any other mutation without **explicit user confirmation**.
- If you must check git status to understand state, use `git status` and `git diff --stat` (read-only).

### 7.3 Dependencies
- **Do not** install global npm/pnpm packages.
- If a new dependency is required, add it to the correct package's `package.json` and run `pnpm install` from the repo root.
- Pin versions explicitly. Do not use floating ranges for new dependencies.

### 7.4 Secrets & Encryption
- **Never** hardcode API keys, passwords, or the AES key in source code.
- Connector configs are encrypted at rest. Do not bypass encryption logic in `apps/fabric/src/db.ts`.
- Do not log decrypted connector configs.

### 7.5 Network & External Systems
- Do not open unexpected outbound connections.
- Do not modify firewall, SSH, or network settings.
- Do not expose the Fastify server or SQLite database to `0.0.0.0` without explicit instruction.

---

## 8. Communication Standards

### 8.1 When to Ask
- Requirements are ambiguous or contradictory.
- You need to choose between multiple valid architectural approaches.
- A change would violate the safety rules above.
- You discover a bug outside the scope of your current task.

### 8.2 When to Report
- Immediately report any test failure you cannot resolve within 3 attempts.
- Report any security concern discovered in the codebase.
- Report if a requested change would require updating >5 files (suggests a missed planning gate).

### 8.3 Completion Summary
When a task is done, provide:
1. **What changed** — files modified, created, deleted.
2. **Why** — the reasoning behind the approach.
3. **Verification results** — output of typecheck, tests, lint.
4. **Next steps** — any follow-up actions required by the user (e.g., restart fabric, update `.env`).

---

## 9. Failure Modes & Escalation

| Situation | Action |
|---|---|
| Type error cannot be resolved without `any` | Escalate to user with explanation |
| Test fails but implementation seems correct | Read the test carefully; if still unclear, escalate |
| Build breaks after `pnpm install` | Check `package.json` changes; do not force with `--force` or `--legacy-peer-deps` |
| Database is locked or corrupted | Stop. Do not delete `.db` files. Ask user for backup status. |
| Git working tree is dirty unexpectedly | Run `git status`, show user, and ask before proceeding |

---

## 10. Checklist Summary (Copy-Paste Before Task)

```markdown
- [ ] Read relevant AGENTS.md and source files
- [ ] Identify and read co-located tests
- [ ] Determine if plan mode is required (§3)
- [ ] Make minimal, targeted changes
- [ ] Add/update tests for new logic
- [ ] Run typecheck on affected packages
- [ ] Run tests on affected packages
- [ ] Run lint if web app touched
- [ ] Verify no secrets committed
- [ ] Summarize changes and verification results
```

---

## 11. Document Lifecycle

This file is maintained alongside the codebase. If you introduce a new architectural pattern, build step, or safety requirement that should govern all agents, append it to the relevant section above and update the checklist.
