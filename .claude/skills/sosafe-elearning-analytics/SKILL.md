---
name: sosafe-elearning-analytics
description: >
  Process skill for instrumenting Amplitude analytics in fe-lib-course-builder
  module templates. Verifies the repo's actual Amplitude init and the canonical
  reference hook before generating a hook, defining event properties, or writing
  a Jira ticket. Trigger on "add analytics to <module>", "instrument <module>
  events", "write analytics hook for <module>", "analytics ticket for LTC-XXXX",
  or any request to add Amplitude tracking to a lesson template.
argument-hint: <module name or Jira ticket — e.g. "phishing" or "LTC-1481">
allowed-tools: >-
  Read
  Glob
  Grep
  Bash(find:*)
  Bash(grep:*)
  Bash(git:*)
  mcp__claude_ai_Atlassian__getConfluencePage
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__editJiraIssue
  mcp__claude_ai_Atlassian__searchConfluenceUsingCql
effort: medium
---

# E-Learning Amplitude Analytics

A process skill: always start from the **code**, not from memory and not from
Confluence alone. Confluence describes the org-wide standard; course-builder is
a deliberate exception to it. Getting that backwards produces confidently wrong
tickets.

---

## Step 1 — Verify the repo's ACTUAL Amplitude init (do this FIRST)

> **The trap.** The org-wide Confluence guidance describes the shared
> `fe-lib-product-analytics` wrapper, which auto-attaches default properties
> (user UUID, customer UUID, mandant/MSP UUID) when `login()` is called.
> **`fe-lib-course-builder` does not use that wrapper.** It calls the Amplitude
> SDK's `init()` directly, because a course library has no authenticated
> host-app session. So the wrapper's default properties **do not apply**, and
> assuming they do will put properties in the ticket that no code ever sets.

```bash
grep -rn "init(\|setUserId\|setGroup\|identify(" \
  ~/projects/fe-lib-course-builder/src/context/analytics.context.tsx
```

Then read the identity block of `src/context/analytics.context.tsx` and
`src/hooks/use-url-params.tsx`. Record, from the code:

- Which identity calls actually fire, and what guards them
- Where each identity value comes from (URL param? config? context?)
- Whether each is an event **property** or an Amplitude **group** — these have
  different semantics downstream and are easy to conflate

**As of the last verification (2026-09-08), course-builder sets exactly two:**

| Call | Source | Semantics |
|---|---|---|
| `setUserId(user_uuid)` | lesson URL param `user_uuid`, forwarded by `be-ms-content-dispatcher` (LTC-1452). Guarded by `if (userUuid)`. | User identity |
| `setGroup('customer', customer_uuid)` | lesson URL param `customer_uuid` | Amplitude **group**, explicitly *not* an event property. Enables per-customer funnel segmentation in reporting; group-scoped cohorts **cannot** be used for guide targeting. |

There is **no mandant/MSP dimension** in course-builder, by design. Don't add it
and don't list it in a ticket as a gap.

Re-verify rather than trusting this table — it is a snapshot, not a contract.

---

## Step 2 — Read the canonical reference hook

`src/hooks/use-vishing-analytics.ts` is the pattern to mirror.

```bash
find ~/projects/fe-lib-course-builder/src/hooks -name "use-*-analytics.ts"
```

Extract:
- The guard (`if (!isAnalyticsEnabled) return`)
- How `commonProps` is built and what it contains
- The `useCallback` dependency array shape
- Any ref-stabilisation for effect-bound trackers
- Confirm no hook already exists for the target module

---

## Step 3 — Fetch the Confluence guidance (context, not gospel)

`mcp__claude_ai_Atlassian__getConfluencePage`
- cloudId: `d100d454-8311-44b7-b60c-c0676e3af987`
- pageId: `3014755132` — *Amplitude Guides Best Practice*, PDEV space
- contentFormat: `markdown`

Useful for org-wide rules that **do** apply regardless of init path:
- Customer UUID vs Manager ID mismatch (Amplitude only ever knows UUIDs)
- Groups are reporting/analysis-scoped and never available as guide-targeting options
- Event-based targeting is preferred over manual cohorts

Treat anything the page says about *auto-attached default properties* as
wrapper-lib behaviour — check it against Step 1 before repeating it.

If the page has moved:
```
searchConfluenceUsingCql → cql: title = "Amplitude Guides Best Practice" AND type = page
```

---

## Step 4 — Define the property taxonomy

### Layer 1 — Identity (set once at init, never per event)
Report exactly what Step 1 found. State explicitly that identity must **not** be
duplicated as event properties — the code comments in `analytics.context.tsx`
and `use-vishing-analytics.ts` both say so.

Name the real failure mode: identity depends on **URL params supplied by
`be-ms-content-dispatcher`**, not on the analytics hook. If `user_uuid` is
missing, every event still fires and every unit test still passes — the data is
just anonymous and the funnel reads 0%. That is what happened before LTC-1452,
and per that ticket **legacy data cannot be backfilled**, so identity must be
correct before a module ships.

### Layer 2 — commonProps (mirror the reference hook)
- `moduleName` — `course?.folderName ?? 'unknown'`
- `moduleLanguage` — `course?.language ?? 'unknown'`
- `moduleVersion` — hardcoded integer (vishing uses `7`); bump on a breaking
  event-schema change

### Layer 3 — Event-specific props
Per event, identify:
1. Payload properties (name, type, allowed values)
2. The segmentation question each answers — e.g. "do Finance learners miss more
   phishing than IT learners?"
3. Whether it can fire from a `useEffect` (if so: ref-stabilise)

Prefer properties that support **customer-group** and **role/persona** slicing —
those feed product decisions. Purely per-learner properties rarely do.

---

## Step 5 — Generate the hook or ticket

### Hook

```ts
export const use<Module>Analytics = () => {
  const { isAnalyticsEnabled } = useProductAnalytics();
  const { course } = useCourse();

  const commonProps = useCallback(
    () => ({
      moduleName: course?.folderName ?? 'unknown',
      moduleLanguage: course?.language ?? 'unknown',
      moduleVersion: <N>,
    }),
    [course],
  );

  const track<Action> = useCallback(
    (<eventProps>) => {
      if (!isAnalyticsEnabled) return;
      track(ANALYTICS_EVENTS.Elearning<Module><Action>, {
        ...commonProps(),
        <eventProps>,
      });
    },
    [isAnalyticsEnabled, commonProps],
  );

  // If the tracker fires inside a useEffect, ref-stabilise:
  // const trackRef = useRef(track<Action>);
  // useEffect(() => { trackRef.current = track<Action>; });

  return { track<Action> };
};
```

Event names go in `src/context/analytics.context.tsx` → `ANALYTICS_EVENTS`.
Format: `PascalCase`, `Elearning<Module><Action>`.

### Jira ticket

Section structure (as used on LTC-1481):

```
## Context
Why it matters. Name the primary metric. State the dependency.

## Scope
Files to create/modify. Event names only — detail goes in ## Properties.

## Properties
### Identity — attached at init, NOT per event
Exactly what Step 1 verified + "do not duplicate as event properties"
+ "these are the whole identity model; wrapper-lib defaults do not apply here".

### The failure mode to guard
Missing URL param → anonymous data → 0% funnel → unbackfillable.

### commonProps
### <EventName>  (one sub-section per event, typed + segmentation rationale)

## Acceptance criteria
- Guard / commonProps-first / deps pattern (mirror reference hook)
- Ref-stabilise effect-bound trackers
- Do NOT add identity values as event properties
- Unit tests: enabled AND disabled case per tracker
- "hook return value" toEqual block includes every new function
- Staging verification completed before close

## Staging verification
(see Step 6)

## Design reference
Dev-brief PR or Figma. If no new UI, say so explicitly.
```

---

## Step 6 — Staging verification

Unit tests cannot catch missing identity. This is the only gate.

1. Play the module in **staging, not Storybook** — it needs a real
   dispatcher-built lesson URL.
2. Confirm the lesson URL carries `user_uuid` **and** `customer_uuid`.
3. In Amplitude, confirm a fired event has a real **User ID** (not just the
   random device ID) and is attributed to the **Customer** group.
4. If User ID is missing: `be-ms-content-dispatcher` is not forwarding
   `user_uuid`. **Stop.** That is a backend dependency, not a frontend bug, and
   shipping anyway produces anonymous data that cannot be backfilled.

---

## Known-wrong answers (don't repeat these)

- ❌ "`userUUID`, `customerUUID` and `mandantUUID` are auto-attached to every
  event." — That is the `fe-lib-product-analytics` wrapper. Course-builder does
  raw `init()` and sets only user ID + customer group.
- ❌ "`customerUUID` is an event property." — It is a `setGroup` group. It won't
  appear in the payload and can't drive guide targeting.
- ❌ "Identity breaks when the SCORM iframe doesn't initialise the wrapper." —
  The real dependency is the dispatcher forwarding URL params.
