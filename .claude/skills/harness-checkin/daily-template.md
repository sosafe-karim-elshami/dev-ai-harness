# Daily file template

**One file per day:** `$VAULT/digests/<YYYY-MM-DD>.md`. Every check-in run for that date reads
and rewrites this same file. Never create `<date>-checkin-<HH>.md`, `<date>-pending.md`, or any
other per-run file. Old-format files from previous runs: leave them alone.

## Merge rules

Exists already → read it, then overwrite with an updated version: preserve every completed
`[x]` item, de-duplicate open items, merge new ones, bump `last_updated`. Doesn't exist →
create from the template below.

Meeting status emoji: `✅` done with notes · `⏳` done, no notes yet · `🔜` still upcoming.

Urgency markers from `${CLAUDE_PLUGIN_ROOT}/definitions/urgency-matrix.json`: priority `🔴 P1` / `🟡 P2` / `⚪ P3`,
flags `⭐ leadership` / `🌐 external` / `⏰ overdue`.

## Index link

After writing, add or replace one line under "## Recent" in `$VAULT/index.md`:

- today → `- [[digests/<TODAY>|📅 <TODAY> (active)]] — <one-line summary>`
- past → `- [[digests/<DATE>|📅 <DATE>]] — <one-line summary>`

Only ever the single daily link — never a per-run one.

## Template

```markdown
---
type: daily
date: <YYYY-MM-DD>
last_updated: "<HH:MM>"
tags: [harness, daily]
---

# 📅 <YYYY-MM-DD> — Daily

## Meetings today

| Time | Meeting | Notes |
|------|---------|-------|
| <HH:MM> ✅/⏳/🔜 | <Title> (<duration>) | [[meetings/<slug>]] or — |

---

## My action items

<!-- Ordered by urgency-matrix: leadership/overdue first, then P1 → P2 → P3, then due date.
     Prefix with priority + flag markers. Bold the top blocker. -->
- [ ] 🔴 ⭐ **<most urgent item>** — due: <date|time> — <context>
- [ ] 🟡 <next item> — due: <date|none>

---

## Meeting prep needed

<!-- Only meetings still upcoming. Omit the section if all prep is done. -->
### <Meeting title> — <HH:MM> today — ⚠️ URGENT / ~X min prep
**Full prep note:** [[meetings/<slug>]]
- [ ] [prep] <what> — due: <HH:MM>

**To review**
- [<Confluence title>](<url>) — <why relevant>

---

## Team items

- [ ] [<Name>] <what> — due: <date|none>

---

## Docs to update

<!-- Omit if nothing is out of sync. -->
- [<page>](<url>) — <reason>

---

## Tomorrow — <YYYY-MM-DD>

### Meetings
| Time | Meeting | Prep |
|------|---------|------|
| <HH:MM> | <Title> | ~<X> min |

### Jira focus
- [<KEY>](<url>): <summary> — due <date|none>

### Carry-over
- [ ] <what>

---

## Reminders
<!-- Performance review, OKR deadlines. Omit if none. -->
```
