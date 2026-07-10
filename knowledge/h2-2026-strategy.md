---
title: SoSafe H2 2026 Technology Strategy
tags: [strategy, h2-2026, ai-engineering, monolith, adaptive-defence, pillars]
sources: [https://sosafegmbh.atlassian.net/wiki/spaces/ENG/pages/3877273643]
updated: 2026-07-09
---

## Summary

H2 turns H1 foundations into customer-visible value and absorbs two new company strategies: AI-native engineering and Adaptive Defence. Three strategic objectives: **Greater Trust**, **Faster Innovation**, **Relevant/Timely/In-Context Experiences**. Next review: October 2026.

---

## Five Pillars

### Pillar 1 — Ensure Resilient Operations → Greater Trust

**Problem:** SLO coverage is at 0.5% (1/189 services). 224/447 Compass components are unowned. Security gate covers only 37% of components (8 at score 0). We cannot verify any customer SLA today.

**H2 targets:**
- Every customer-facing surface has a live uptime + performance SLI meeting 99% monthly SLA
- Zero unowned Compass components; zero components in the failing security band (score 0–49)
- Every component classified in Compass by lifecycle, tier, and CD/SLO eligibility
- Critical/high security vulnerabilities resolved within their SLA commitment; ≥80% of mediums within SLA

### Pillar 2 — Move Fast, Stay Safe → Faster Innovation

**Problem:** Delivery is inconsistent, not slow. Pipeline is fast (median stage→prod ~35 min) but the manual production gate is rarely flipped. 38% of services have staging changes queued. CFR is not yet measurable. Feature environments exist but aren't reliably usable.

**H2 targets:**
- CD is the default path for all new services
- CD adoption ~50% by end of H2 (from 15% today)
- CFR ≤15%
- Feature environments usable by every team; ≥80% of product engineering teams use them at least once per sprint

### Pillar 3 — Build the AI Engineering Platform → Faster Innovation

**Problem:** AI tooling adoption is real (46% of repos, Claude in 77) but shared practices lag. Agent skills ship in only 22 repos. Spend is $21–34k/month with no per-team attribution. Teams rebuild the same agents independently, each with different safety assumptions.

**H2 targets:**
- Every actively agentic repo runs on the shared agent direction baseline, with all 7 foundational AI engineering categories available: **skills, patterns, MCPs, workflows, evaluation, guidelines, metrics**
- AI safety controls (sandbox isolation, MCP allowlist, PII masking, Semgrep blocking) ship as defaults every agentic repo inherits
- Self-serve autonomous agents: switch on a shared one or stand up your own, on a shared runtime
- Per-team AI engineering productivity, quality, and cost are observable with per-team attribution
- DORA baseline established and read as trends (throughput rising, quality guardrails holding); absolute targets deferred to 2027

**Key institutions:**
- **AI Guild** — cross-team learning forum for harness alignment and shared practices; primary mitigation for uneven adoption and knowledge gaps
- **AI Champions** — one per team, named, with a written charter distinguishing guild work from team work

### Pillar 4 — Burn Down The Monoliths → Relevant/Timely/In-Context

**Problem:** E-Learning (84%/24% code/data), Simulation (87%/57%), AIM (31%/17%) remain coupled. Estate-wide: ~75% code / ~48% data. Data coupling is the hard part — dependency mapping, rollout coordination, and observability for cut-over rival the schema work.

**H2 targets:**
- E-Learning, Simulation, AIM ship without coordinating monolith changes; code and data coupled only at contract boundaries
- Simulation extracted (failure no longer cascades to E-Learning or AIM)
- E-Learning owns its data schema (no shared-table writes)
- Auth/Authz and User Data in their own boundaries (key for Adaptive Defence's per-user behavioural signals)

### Pillar 5 — Run the Agentic Platform at Production Scale → Relevant/Timely/In-Context

**Problem:** Agentic Platform service exists but isn't the default path. Teams use direct integrations. AD platform needs are still being scoped.

**H2 targets:**
- Agentic Platform is the default path for all new customer-facing AI features
- ≥3 cross-domain AI workflows running on it
- Production agents on default runtime in SoSafe AWS
- AD platform needs met as the AD team identifies them (not a fixed connector set)

Convergence of Adaptive Defence onto Agentic Platform: H1 2027 decision (does not gate H2).

---

## Adaptive Defence

New Product Strategy pillar. Bet: scheduled training hasn't moved the 68–80% of breaches where humans are the deciding factor. Answer: continuous loop of threat intelligence + behavioural data + just-in-time intervention.

- Tiger team owns the build; first MVP within 4–6 weeks, further iterations through H2
- Platform support preferred but not gating the tiger team
- Customer tech stack: mixed environments (M365 + Google Workspace, varied identity/endpoint)
- AD convergence onto Agentic Platform: H1 2027

---

## What's Deliberately Off the Agenda

- Multi-cloud or sovereign cloud (no customer driver)
- Multi-region production deployment (throughput is the bottleneck, not geography)
- Major refactoring inside existing monoliths (decouple at boundaries first)
- A standalone AI pillar (AI is integral to the existing pillars)
- Full E-Learning domain extraction (read-decoupling pattern ships in H2; full extraction deferred)

---

## Relevance to Learning Technology (Karim's Team)

| Area | Current | H2 Target | Pillar |
|------|---------|-----------|--------|
| E-Learning code decoupling | 84% | Contract boundaries, no monolith coordination | 4 |
| E-Learning data decoupling | 24% | Own data schema, no shared-table writes | 4 |
| CD adoption (LT repos) | ~15% avg | ~50% | 2 |
| Compass ownership (LT components) | Some unowned | Zero unowned, zero score 0–49 | 1 |
| AI engineering harness | This repo | Shared baseline with all 7 categories | 3 |

**Pillar 3 is a direct career opportunity for Karim.** The dev-ai-harness he maintains IS the shared agent direction baseline Engineering is trying to roll out. AI Guild participation and AI Champion role are the highest-leverage visibility moves available this half — they connect day-to-day harness work to a named company strategy.
