# Hook, ticket, and verification templates

## Hook

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

Event names go in `src/context/analytics.context.tsx` → `ANALYTICS_EVENTS`. Format:
`PascalCase`, `Elearning<Module><Action>`.

## Jira ticket

Section structure, as used on LTC-1481:

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
### <EventName>   (one sub-section per event, typed + segmentation rationale)

## Acceptance criteria
- Guard / commonProps-first / deps pattern (mirror reference hook)
- Ref-stabilise effect-bound trackers
- Do NOT add identity values as event properties
- Unit tests: enabled AND disabled case per tracker
- "hook return value" toEqual block includes every new function
- Staging verification completed before close

## Staging verification
(see below)

## Design reference
Dev-brief PR or Figma. If no new UI, say so explicitly.
```

## Staging verification — the only real gate

Unit tests cannot catch missing identity.

1. Play the module in **staging, not Storybook** — it needs a real dispatcher-built lesson URL.
2. Confirm the lesson URL carries `user_uuid` **and** `customer_uuid`.
3. In Amplitude, confirm a fired event has a real **User ID** (not just the random device ID)
   and is attributed to the **Customer** group.
4. User ID missing → `be-ms-content-dispatcher` isn't forwarding `user_uuid`. **Stop.** That's
   a backend dependency, not a frontend bug, and shipping anyway produces anonymous data that
   cannot be backfilled.
