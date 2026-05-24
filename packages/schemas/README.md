# `@overwatch/schemas` — shared Zod schemas

The contract between fabric and web. **Every** domain type used on
both sides originates here. Components and connectors import types
from `@overwatch/schemas` and parse runtime payloads with the matching
Zod schema.

**Test**: there are no separate tests; types are exercised transitively
by fabric + web test suites.

---

## What lives here

| Schema | Purpose |
|---|---|
| `GeoPoint`, `EventLocation` | lat/lon (+ optional alt/radius) primitives |
| `Severity`, `EventCategory`, `EventKind` | enums |
| `IngestEvent` | The universal envelope every connector emits |
| `ThreatCon`, `PIR` | THREATCON level + priority intelligence requirements |
| `CameraFeed` | Camera config (incl. `detectionMode`) |
| `CvEvent`, `CvDetection` | Computer-vision events emitted from the browser |
| `DroneTrack`, `DroneClassification` | Aggregated drone surveillance state |
| `AlertRule`, `AlertRuleCondition`, `AlertFiring` | Rule engine schemas |
| `Location` | Tactical location entity (HQ, office, etc.) |
| `ServerToClient` | **Discriminated union** of every WS message fabric can send |

The `ServerToClient` union is the most important type in the project —
treat any additions as breaking the wire protocol.

---

## Conventions

- Every exported schema also exports an inferred TS type with the same
  name (e.g. `export const Foo = z.object({...}); export type Foo = z.infer<typeof Foo>;`).
- `EventCategory` and `Severity` are string enums for human display
  and rule matching; don't switch them to numeric.
- Prefer `z.discriminatedUnion("type", [...])` for variant types — it
  generates better TS narrowing than `z.union`.
- Optional fields use `.optional()`; nullable fields use `.nullable()`.
  Don't mix them without a reason.

---

## Adding to `ServerToClient`

1. Define the new variant: `z.object({ type: z.literal("foo"), data: FooSchema })`.
2. Append it to the `ServerToClient` discriminated union.
3. Add a `case "foo":` to the dispatch table in `apps/web/src/lib/ws.ts`.
4. Add a broadcaster on the fabric side that emits the new variant.
5. Bump `docs/FEATURES.md` if the new message corresponds to a user-
   visible feature.

---

## Notes for agents

- Path alias `@overwatch/schemas` is wired in `tsconfig.base.json` and
  resolves to `packages/schemas/src/index.ts`. Don't import via relative
  path from outside the package.
- Schemas are evaluated at module load — keep them dependency-free
  (no fetches, no env reads).
- A schema and its inferred TS type share a name. When refactoring,
  rename both, then `grep` for stale references in fabric and web.
