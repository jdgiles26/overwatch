# 05 — `@overwatch/ui` · TDD checklist (phase 1 only)

- [ ] `packages/ui/src/TopBar.tsx`, `EventDetail.tsx`,
      `ConsoleFilter.tsx`, `TimeScrubber.tsx` exist.
- [ ] None of them import `useStore` or any path under `apps/web`.
- [ ] Each has a smoke render test that mounts under jsdom with
      mocked props and asserts the root element renders.
- [ ] `apps/web/src/components/{TopBar,EventDetail,ConsoleFilter,TimeScrubber}.tsx`
      are reduced to re-export shims or removed.
- [ ] `packages/ui/README.md` placeholder banner removed.
- [ ] Follow-up specs `05.2-ui-store-coupled/` and `05.3-ui-sdk-coupled/`
      exist (can be skeleton-only).
