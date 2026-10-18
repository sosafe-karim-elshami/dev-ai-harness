# Agent output contract

Binding on every `.claude/agents/*.md` subagent. The orchestrating skill parses the reply
deterministically; prose would force it to re-read and re-judge, which is the cost the
subagent exists to avoid.

## Shape

```
<AGENT>_COMPLETE            ← line 1: sentinel, upper-snake of the agent name + _COMPLETE | _BLOCKED
{ ...one JSON object... }   ← line 2 onward: exactly one object, no fences, no trailing prose
```

- `_BLOCKED` means the agent could not do its job; the object then carries `{"reason": "...", "needs": [...]}` and nothing else.
- Keys are documented in the agent file's `## Output` section. Add keys, never rename them.
- Strings are evidence-bearing: a finding names `path:line`, a Jira key, a PR number, a screenshot path, or a command. A claim with no evidence is dropped by the caller.
- Cap arrays at ten entries and state the total in a `total` key when truncated.
- Never ask the user anything (`AskUserQuestion` is disallowed); put the question in `needs`.

## Parsing

The caller splits on the first newline, checks the sentinel, and `JSON.parse`s the rest.
A reply that fails to parse counts as `_BLOCKED` with `reason: "unparseable"` and is retried
at most once.
