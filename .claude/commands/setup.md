Bootstrap (or refresh) the harness for the current user. Usage: `/setup` or `/setup --field <repos|team|jira|slack|person>`.

## Steps

### 1 — Marketplace & plugins
Confirm the harness's reused plugins are available. `.claude/settings.json` already declares the `sosafe-claude-market` marketplace and enables the plugins, so in most cases trusting this repo is enough. As a fallback, if any are missing, tell the user to run:

```
/plugin marketplace add sosafe-platform-engineering/dev-ai-claude-marketplace
```

The plugins the harness reuses: `sosafe-engineering-metrics`, `sosafe-pr-workflow`, `sosafe-planning`, `sosafe-security`, `sosafe-architecture`. Do not reimplement their functionality.

### 2 — Discover & persist the profile
Invoke the **harness-onboarding** skill. It runs read-only discovery across GitHub/Jira/Confluence/Slack, confirms values with the user, and writes `~/.claude/sosafe-harness/profile.json`.

- If `--field <name>` is passed, forward it so only that section is re-discovered.
- If a valid profile already exists and no `--field` is given, ask whether to refresh all, refresh one section, or keep it.

### 3 — Offer to build the workspace
After the profile is saved, ask: "Clone the repos you maintain into `workspace/` now?" If yes, invoke the **harness-workspace** skill.

### 4 — Set up the knowledge vault (Obsidian)
The vault **setup is shared** (templates + scaffold script ship in the repo); each dev gets **their own private vault**. Offer to scaffold it now.
- Ask where their vault should live. Sensible default: a `Harness` folder inside their existing Obsidian vault if one exists (look under `~/Documents` for a `.obsidian` folder), else `~/Documents/SoSafe-Harness`.
- Run the scaffold script (idempotent, never overwrites notes):
  ```
  .claude/skills/harness-onboarding/scaffold-vault.sh "<chosen-vault-dir>"
  ```
- Record the path so any session can find it (no other harness code hardcodes it):
  ```
  jq --arg p "<chosen-vault-dir>" '.vaultPath=$p' ~/.claude/sosafe-harness/config.json > /tmp/harness-config.json && mv /tmp/harness-config.json ~/.claude/sosafe-harness/config.json
  ```
- Install the global `/notes` command so it works from any repo/session:
  ```
  mkdir -p ~/.claude/commands && cp .claude/commands/notes.md ~/.claude/commands/notes.md
  ```
- The vault **content** is personal — never commit it. Only the templates/scaffold/command are shared.

### 5 — Point the user at daily use
Finish by listing the daily commands: `/standup`, `/triage`, `/meeting`, `/notes`, `/harness`.
