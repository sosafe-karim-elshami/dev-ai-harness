# sosafe-harness-runner — a sandbox for the scheduled jobs that touch the vault.
#
# Why: on macOS a launchd job needs Full Disk Access to read ~/Documents. Instead the
# vault is bind-mounted into this container by Docker Desktop (file sharing, no FDA),
# and the job runs here with nothing but the mounts it is given. The harness repo is
# mounted read-only; the per-user state dir is mounted so audit logs and last-run.json
# land where `harness doctor` reads them; `/root/.claude` is a named volume that holds
# the container's own Claude Code login (OAuth via `harness docker login`, or pass
# ANTHROPIC_API_KEY in ~/.claude/sosafe-harness/docker.env).
FROM node:24-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates jq \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code \
 && npm cache clean --force

ENV HARNESS_REPO=/harness \
    HARNESS_VAULT=/vault \
    HOME=/root \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

WORKDIR /harness
ENTRYPOINT ["node", "/harness/cli/dist/index.js"]
CMD ["compress"]
