# rv-trip — task runner for the things that don't fit a pnpm script.
# `make help` lists targets. Day-to-day dev stays on pnpm (see README).
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

.PHONY: help
help: ## Print this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n\nTargets:\n"} \
		/^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# ─── Mobile release (TripCaddie · EAS → TestFlight) ──────────────────────────
.PHONY: release-mobile release-mobile-ios release-mobile-android
release-mobile: ## Build + auto-submit a production TripCaddie release (interactive survey, iOS). See scripts/release-mobile.sh
	@scripts/release-mobile.sh
release-mobile-ios: ## Release iOS only (interactive)
	@scripts/release-mobile.sh --platform ios
release-mobile-android: ## Build Android only (interactive; no Play submit config yet)
	@scripts/release-mobile.sh --platform android
