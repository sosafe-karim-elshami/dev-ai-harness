<!-- Generated from definitions/registry.json by `harness registry sync`. Do not hand-edit. -->

# Routing index

| Route to | Tier | Triggers |
|---|---|---|
| /setup → harness-onboarding | sonnet | set me up; onboard me; refresh my profile; first run; profile missing or wrong schema_version |
| harness-workspace | haiku | clone my repos; pull the projects I maintain; set up my workspace; update my repos |
| harness-pm | sonnet | how's the sprint; team status; Jira hygiene; what PRs need review; any stale tickets |
| /triage → harness-support-triage | opus | any support waiting; unanswered questions; triage support; anyone need a reply |
| /monitoring → harness-monitoring | sonnet | any errors; how's production; what's alerting; Sentry issues; Datadog monitors |
| /meeting → harness-meetings | sonnet | prep my next meeting; what's my 2pm about; agenda for standup; take notes; ingest my Gemini notes |
| /checkin → harness-checkin | sonnet | wrap up today; what happened today; prepare for tomorrow; collect my action items; prep my meetings |
| /groom → harness-groom | opus | groom my backlog; get my tickets ready; refine the backlog; sprint prep; is this ticket ready |
| /review → harness-review | opus | review this; review my changes; review this PR; is this ready to merge; check this branch |
| /ship → harness-ship | opus | ship this ticket; implement LTC-; take this ticket to a draft PR; build it and open a PR; autonomous implement |
| /growth → harness-growth | opus | how's my career going; 1:1 growth prep; what should I present; visibility gap; IDP check |
| /self-improve → harness-self-improve | opus | self-improve; how could the harness work better; reflect and improve |
| harness-find-skill | haiku | which skill handles; what harness command does; is there a skill for |
| sosafe-elearning-analytics | sonnet | add analytics to a module; instrument module events; analytics hook; analytics ticket |
| /standup (scatter/gather) | sonnet | Role-ordered daily driver. Scatter the scans, gather into one digest. |
| harness dashboard (scatter/gather) | sonnet | CLI dev status at a glance; caches a structured snapshot for --cached re-render. |

Reuse, never rebuild:
- metrics → compass-analyst (sosafe-engineering-metrics)
- pull-requests → sosafe-pr-workflow
- ticket-creation → sosafe-planning
- ticket-quality-size-split → sosafe-ticket-loop
- security-review → sosafe-security
- architecture-review → sosafe-architecture
- autonomous-code-to-pr → sosafe-ai-harness-task-to-pr:implement-task (wrapped by /ship — never call it bare for ticket work)
- repo-claude-md → sosafe-ai-harness-claude-md:generate-claude-md
- notes-capture → /notes (global, Obsidian vault)

Never routable: harness-developer, harness-reviewer, harness-tester.
