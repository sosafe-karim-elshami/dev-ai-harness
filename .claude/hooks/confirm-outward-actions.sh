#!/bin/bash
# Outward-action safety gate for the harness (PreToolUse).
#
# Forces a one-keystroke confirmation before any action that leaves the machine
# or mutates remote state: Slack posts, Jira/Confluence writes, email sends,
# git push, and PR/issue creation/merge.
#
# Registered in .claude/settings.json against a matcher that already narrows MCP
# tools to the outward ones. For Bash we inspect the command so read-only git/gh
# usage is never gated. Read tools and *_draft tools are not matched at all.
#
# Emits permissionDecision "ask" (not "deny") so the user just confirms.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')

# In autonomous mode (the `harness` CLI sets HARNESS_AUTONOMOUS=1 for
# non-interactive runs) there is no human to confirm, so every outward action is
# DENIED rather than asked — runs stay strictly read-only / draft-only. The
# agent should use *_draft tools or surface the proposed action for later
# approval instead.
if [[ "${HARNESS_AUTONOMOUS:-}" == "1" ]]; then
  DECISION="deny"
  SUFFIX=" [autonomous mode: denied — produce a draft instead]"
else
  DECISION="ask"
  SUFFIX=""
fi

ask() {
  # $1 = human-readable reason
  jq -n --arg reason "$1$SUFFIX" --arg decision "$DECISION" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: $decision,
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

case "$TOOL" in
  Bash)
    COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
    [[ -z "$COMMAND" ]] && exit 0
    if echo "$COMMAND" | grep -qE '(^|[[:space:]&;|])git[[:space:]]+push([[:space:]]|$)'; then
      ask "Outward action: \`git push\` will publish commits to the remote. Confirm before pushing."
    fi
    if echo "$COMMAND" | grep -qE '(^|[[:space:]&;|])gh[[:space:]]+pr[[:space:]]+(create|merge)([[:space:]]|$)'; then
      ask "Outward action: \`gh pr $(echo "$COMMAND" | grep -oE 'pr[[:space:]]+(create|merge)' | awk '{print $2}')\` affects GitHub. Confirm first."
    fi
    if echo "$COMMAND" | grep -qE '(^|[[:space:]&;|])gh[[:space:]]+issue[[:space:]]+create([[:space:]]|$)'; then
      ask "Outward action: \`gh issue create\` will open a GitHub issue. Confirm first."
    fi
    # Sentry (and monitoring) writes: reads are free, mutations are gated.
    if echo "$COMMAND" | grep -qE '(^|[[:space:]&;|])sentry[[:space:]]+(issue[[:space:]]+(resolve|unresolve|archive|merge)|alert[[:space:]]+(issues|metrics)[[:space:]]+(create|edit|delete)|dashboard[[:space:]]+(create|restore|widget)|release[[:space:]]+(create|finalize|delete|archive|restore|deploy|set-commits)|project[[:space:]]+(create|delete)|trial[[:space:]]+start|event[[:space:]]+send)([[:space:]]|$)'; then
      ask "Outward action: this \`sentry\` command mutates Sentry state. Confirm before applying."
    fi
    # Any other Bash command is fine.
    exit 0
    ;;
  *slack_send_message|*slack_schedule_message|*slack_create_canvas|*slack_update_canvas)
    CH=$(echo "$INPUT" | jq -r '.tool_input.channel // .tool_input.channel_id // .tool_input.conversation_id // "a Slack channel"')
    ask "Outward action: posting to Slack ($CH). Review the draft, then confirm to send."
    ;;
  *transitionJiraIssue|*editJiraIssue|*addCommentToJiraIssue)
    KEY=$(echo "$INPUT" | jq -r '.tool_input.issueIdOrKey // .tool_input.cloudId // "a Jira issue"')
    ask "Outward action: modifying Jira ($KEY). Confirm before applying."
    ;;
  *createJiraIssue)
    ask "Outward action: creating a Jira issue. Confirm before creating."
    ;;
  *createConfluencePage|*updateConfluencePage|*createConfluenceFooterComment|*createConfluenceInlineComment)
    ask "Outward action: writing to Confluence. Confirm before publishing."
    ;;
  *Gmail*)
    ask "Outward action: sending email via Gmail. Review the draft, then confirm."
    ;;
  *)
    # Matched by the settings matcher but not specifically handled — be safe.
    ask "Outward action via $TOOL. Confirm before proceeding."
    ;;
esac

exit 0
