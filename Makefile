HARNESS_CACHE := $(HOME)/.claude/plugins/cache/sosafe-harness/dev-ai-harness/unknown
SOSAFE_MARKET := $(HOME)/.claude/plugins/marketplaces/sosafe-claude-market
SOSAFE_CACHE  := $(HOME)/.claude/plugins/cache/sosafe-claude-market
SOSAFE_PLUGINS := sosafe-architecture sosafe-engineering-metrics sosafe-planning sosafe-pr-workflow sosafe-security

.PHONY: sync sync-harness sync-sosafe

# Push local .claude/ changes into the harness plugin cache.
sync-harness:
	@echo "→ syncing harness plugin cache"
	@cp -r .claude/. $(HARNESS_CACHE)/.claude/
	@echo "  done"

# Pull latest sosafe marketplace and refresh installed plugin caches in-place.
sync-sosafe:
	@echo "→ pulling sosafe marketplace"
	@git -C $(SOSAFE_MARKET) pull --quiet
	@echo "→ updating sosafe plugin caches"
	@for plugin in $(SOSAFE_PLUGINS); do \
		src="$(SOSAFE_MARKET)/plugins/$$plugin"; \
		dst=$$(ls -dt $(SOSAFE_CACHE)/$$plugin/*/ 2>/dev/null | head -1); \
		if [ -d "$$src" ] && [ -n "$$dst" ]; then \
			cp -r $$src/. $$dst; \
			echo "  updated $$plugin → $$dst"; \
		else \
			echo "  skip $$plugin (not installed or not in marketplace)"; \
		fi \
	done
	@echo "  done"

# Sync both harness and sosafe.
sync: sync-harness sync-sosafe
