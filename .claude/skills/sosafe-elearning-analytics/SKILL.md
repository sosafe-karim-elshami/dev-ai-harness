---
name: sosafe-elearning-analytics
description: >
  Process skill for instrumenting Amplitude analytics in fe-lib-course-builder
  module templates. Fetches live Confluence guidelines first, then reads the
  canonical reference hook, before generating a hook, defining event properties,
  or writing a Jira ticket. Trigger on "add analytics to <module>", "instrument
  <module> events", "write analytics hook for <module>", "analytics ticket for
  LTC-XXXX", or any request to add Amplitude tracking to a lesson template.
argument-hint: <module name or Jira ticket — e.g. "phishing" or "LTC-1481">
allowed-tools: >-
  Read
  Glob
  Grep
  Bash(find:*)
  Bash(git:*)
  mcp__claude_ai_Atlassian__getConfluencePage
  mcp__claude_ai_Atlassian__getJiraIssue
  mcp__claude_ai_Atlassian__editJiraIssue
  mcp__claude_ai_Atlassian__searchConfluenceUsingCql
effort: medium
---

# E-Learning Amplitude Analytics

A process skill: always start from Confluence and the reference hook — never
from memory — so patterns stay in sync with how the team actually uses Amplitude.

---

## Step 1 — Fetch current Confluence guidelines

Call `mcp__claude_ai_Atlassian__getConfluencePage` with:
- cloudId: `d100d454-8311-44b7-b60c-c0676e3af987`
- pageId: `3014755132`  (Amplitude Guides Best Practice, PDEV space)
- contentFormat: `markdown`

Extract and hold:
- **Identity properties** the wrapper auto-attaches (listed under "Tracking implementation for events")
- **Iframe risk warning** — events sent from an uninitialised iframe lose all identity properties and become unsegmentable
- **Cohort targeting rules** — customer UUID vs Manager ID mismatch warning; mandantUUID separates MSP from direct customers

If the page has moved, search with:
```
mcp__claude_ai_Atlassian__searchConfluenceUsingCql
  cql: title = "Amplitude Guides Best Practice" AND type = page
```

---

## Step 2 — Read the canonical reference hook

The reference is `src/hooks/use-vishing-analytics.ts` in `fe-lib-course-builder`.

```bash
find ~/projects/fe-lib-course-builder/src/hooks -name "use-vishing-analytics.ts" | head -1
```

Read the file and extract:
- The guard pattern (`if (!isAnalyticsEnabled) return`)
- How `commonProps` is built (`useCallback` over `course.folderName`, `course.language`, `moduleVersion`)
- The `useCallback` dependency array shape (`[isAnalyticsEnabled, commonProps]`)
- Any existing ref-stabilisation examples for effect-bound trackers

Also grep for any existing analytics hook for the target module to avoid duplication:
```bash
find ~/projects/fe-lib-course-builder/src/hooks -name "use-*-analytics.ts"
```

---

## Step 3 — Define the property taxonomy

Structure properties in three layers. The Confluence page (Step 1) dictates Layer 1;
the reference hook (Step 2) dictates Layer 2; the module's interaction model dictates Layer 3.

### Layer 1 — Auto-attached (from Confluence)
These travel with every event when the wrapper initialises correctly.
List them explicitly in the Jira ticket so the team knows they're available for
segmentation without any code changes. Typically: `userUUID`, `customerUUID`,
`mandantUUID` — but verify against the live Confluence page in case they changed.

**Invariant:** This module runs inside a SCORM iframe. Confirm the wrapper
initialises before events fire — if not, all three properties are silently
missing and the data becomes unsegmentable. Unit tests cannot catch this.
Staging verification is the only gate (see Step 5).

### Layer 2 — commonProps (from reference hook)
Mirror the reference hook exactly. Typically:
- `moduleName` — `course?.folderName ?? 'unknown'`
- `moduleLanguage` — `course?.language ?? 'unknown'`
- `moduleVersion` — hardcoded integer; bump when the event schema has a breaking change

### Layer 3 — Event-specific props
For each event, identify:
1. The **payload properties** (name, type, allowed values)
2. The **segmentation question** each property answers (e.g. "do Finance learners miss more phishing?")
3. Whether the event can fire from inside a `useEffect` (if so: ref-stabilise the tracker)

Prioritise properties that enable **customer-level** and **role/persona-level** segmentation
over purely individual-learner properties — those are the ones that feed product decisions.

---

## Step 4 — Generate the hook or ticket

### Hook (if implementing)

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

  // If tracker fires inside a useEffect, ref-stabilise:
  // const trackRef = useRef(track<Action>);
  // useEffect(() => { trackRef.current = track<Action>; });

  return { track<Action>, ... };
};
```

Event names go in `src/context/analytics.context.tsx` → `ANALYTICS_EVENTS`.
Format: `PascalCase`, prefix `Elearning<Module>`, suffix the interaction
(e.g. `ElearningPhishingRoleSelected`).

### Jira ticket (if writing)

Use this section structure (sourced from LTC-1481):

```
## Context
Why this matters. Name the primary metric. State the dependency.

## Scope
- Files to create/modify (bullet list)
- Events to add (names only; detail goes in ## Properties)

## Properties
### Auto-attached (segmentation foundation)
List the properties from Step 1 + the SCORM iframe warning.

### commonProps
moduleName, moduleLanguage, moduleVersion — from Step 2.

### <EventName> (one sub-section per event)
Typed properties + one-line segmentation rationale per property.

## Acceptance criteria
- Guard / commonProps / deps pattern (mirror reference hook)
- Ref-stabilise any tracker that fires from an effect
- Unit tests: enabled AND disabled cases for every tracker
- "hook return value" toEqual block includes every new function
- Staging: confirm auto-attached identity props present in event stream (see ## Staging)

## Staging verification
Open the Amplitude event stream in a staging playthrough.
Fire each new event at least once.
Confirm <userUUID>, <customerUUID>, <mandantUUID> are present on at least one event.
Do not close the ticket without this check.

## Design reference
Link to dev-brief PR or Figma. If no new UI: state that explicitly.
```

---

## Step 5 — Staging verification checklist

Before the ticket is closed or the PR merged:

1. Run the module in a staging environment (not Storybook — the SCORM wrapper must be active)
2. Open the Amplitude event stream or debugger
3. Fire each new event
4. Confirm the auto-attached identity properties from Step 1 are present on at least one event
5. If any are missing: the wrapper did not initialise in the iframe. Stop. Do not ship.

**Why this is non-negotiable:** vishing analytics once reported 0% engagement
because identity was not attached. All unit tests passed. The error was invisible
until a staging playthrough.
