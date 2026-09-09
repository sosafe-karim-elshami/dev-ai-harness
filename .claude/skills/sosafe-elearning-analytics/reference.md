# Identity model and property taxonomy

## Step 1 — Verify the repo's ACTUAL Amplitude init (always first)

> **The trap.** Org-wide Confluence guidance describes the shared
> `fe-lib-product-analytics` wrapper, which auto-attaches default properties (user UUID,
> customer UUID, mandant/MSP UUID) when `login()` is called. **`fe-lib-course-builder` does
> not use that wrapper.** It calls the Amplitude SDK's `init()` directly, because a course
> library has no authenticated host-app session. The wrapper's defaults **do not apply**, and
> assuming they do puts properties in the ticket that no code ever sets.

```bash
grep -rn "init(\|setUserId\|setGroup\|identify(" \
  ~/projects/fe-lib-course-builder/src/context/analytics.context.tsx
```

Then read the identity block of `src/context/analytics.context.tsx` and
`src/hooks/use-url-params.tsx`. Record, from the code: which identity calls actually fire and
what guards them; where each value comes from (URL param? config? context?); and whether each
is an event **property** or an Amplitude **group** — different downstream semantics, easily
conflated.

**As of the last verification (2026-09-08), course-builder sets exactly two:**

| Call | Source | Semantics |
|---|---|---|
| `setUserId(user_uuid)` | lesson URL param `user_uuid`, forwarded by `be-ms-content-dispatcher` (LTC-1452). Guarded by `if (userUuid)`. | User identity |
| `setGroup('customer', customer_uuid)` | lesson URL param `customer_uuid` | Amplitude **group**, explicitly *not* an event property. Enables per-customer funnel segmentation; group-scoped cohorts **cannot** drive guide targeting. |

There is **no mandant/MSP dimension** in course-builder, by design. Don't add it, and don't
list it in a ticket as a gap. Re-verify rather than trusting this table — it's a snapshot, not
a contract.

## Step 2 — Read the canonical reference hook

`src/hooks/use-vishing-analytics.ts` is the pattern to mirror.

```bash
find ~/projects/fe-lib-course-builder/src/hooks -name "use-*-analytics.ts"
```

Extract: the guard (`if (!isAnalyticsEnabled) return`); how `commonProps` is built and what it
contains; the `useCallback` dependency array shape; any ref-stabilisation for effect-bound
trackers. Confirm no hook already exists for the target module.

## Step 3 — Confluence guidance (context, not gospel)

`getConfluencePage` — cloudId `d100d454-8311-44b7-b60c-c0676e3af987`, pageId `3014755132`
(*Amplitude Guides Best Practice*, PDEV space), contentFormat `markdown`.

Org-wide rules that **do** apply regardless of init path: customer UUID vs Manager ID mismatch
(Amplitude only knows UUIDs); groups are reporting-scoped and never available for guide
targeting; event-based targeting beats manual cohorts.

Treat anything about *auto-attached default properties* as wrapper-lib behaviour — check it
against Step 1 before repeating it. Page moved →
`searchConfluenceUsingCql`: `title = "Amplitude Guides Best Practice" AND type = page`.

## Step 4 — Property taxonomy

**Layer 1 — Identity** (set once at init, never per event). Report exactly what Step 1 found.
State explicitly that identity must **not** be duplicated as event properties — the comments
in `analytics.context.tsx` and `use-vishing-analytics.ts` both say so.

Name the real failure mode: identity depends on **URL params supplied by
`be-ms-content-dispatcher`**, not on the analytics hook. Missing `user_uuid` → every event
still fires, every unit test still passes, the data is anonymous and the funnel reads 0%. That
is what happened before LTC-1452, and per that ticket **legacy data cannot be backfilled** —
so identity must be correct before a module ships.

**Layer 2 — commonProps** (mirror the reference hook):

- `moduleName` — `course?.folderName ?? 'unknown'`
- `moduleLanguage` — `course?.language ?? 'unknown'`
- `moduleVersion` — hardcoded integer (vishing uses `7`); bump on a breaking event-schema change

**Layer 3 — Event-specific props.** Per event: the payload properties (name, type, allowed
values); the segmentation question each answers (e.g. "do Finance learners miss more phishing
than IT learners?"); and whether it can fire from a `useEffect` (if so, ref-stabilise).

Prefer properties that support **customer-group** and **role/persona** slicing — those feed
product decisions. Purely per-learner properties rarely do.

## Known-wrong answers — do not repeat

- ❌ "`userUUID`, `customerUUID` and `mandantUUID` are auto-attached to every event." That's
  the `fe-lib-product-analytics` wrapper. Course-builder does raw `init()` and sets only user
  ID + customer group.
- ❌ "`customerUUID` is an event property." It's a `setGroup` group — absent from the payload,
  and it can't drive guide targeting.
- ❌ "Identity breaks when the SCORM iframe doesn't initialise the wrapper." The real
  dependency is the dispatcher forwarding URL params.
