#!/usr/bin/env bash
# ==============================================================================
# WE Upstream Synchronization Pipeline
# Source Repository: https://github.com/iofficeai/aionui.git
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

UPSTREAM_URL="https://github.com/iofficeai/aionui.git"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# Color codes
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}   WE Upstream Synchronization Manager              ${NC}"
echo -e "${CYAN}   Source: ${UPSTREAM_URL}${NC}"
echo -e "${CYAN}   Active Branch: ${CURRENT_BRANCH}${NC}"
echo -e "${CYAN}====================================================${NC}"

# 1. Ensure upstream remote exists
if ! git remote get-url upstream >/dev/null 2>&1; then
  echo -e "${YELLOW}Configuring 'upstream' remote pointing to ${UPSTREAM_URL}...${NC}"
  git remote add upstream "${UPSTREAM_URL}"
else
  CURRENT_REMOTE_URL="$(git remote get-url upstream)"
  if [[ "${CURRENT_REMOTE_URL}" != "${UPSTREAM_URL}" ]]; then
    echo -e "${YELLOW}Updating 'upstream' remote to ${UPSTREAM_URL}...${NC}"
    git remote set-url upstream "${UPSTREAM_URL}"
  fi
fi

# 2. Fetch latest upstream commits and tags
echo -e "${CYAN}Fetching latest upstream commits, branches, and release tags...${NC}"
git fetch upstream main --tags

# 3. Check diff between current HEAD and upstream/main
BEHIND_COUNT="$(git rev-list --count HEAD..upstream/main 2>/dev/null || echo "0")"
AHEAD_COUNT="$(git rev-list --count upstream/main..HEAD 2>/dev/null || echo "0")"

echo -e "Upstream Status:"
echo -e "  - Commits in upstream not in current branch: ${YELLOW}${BEHIND_COUNT}${NC}"
echo -e "  - Custom WE commits ahead of upstream: ${GREEN}${AHEAD_COUNT}${NC}"

if [[ "${BEHIND_COUNT}" -eq 0 ]]; then
  echo -e "${GREEN}✓ You are fully up to date with upstream/main! No new changes to pull.${NC}"
  exit 0
fi

echo -e "\n${YELLOW}Latest commits available in upstream/main:${NC}"
git log -n 10 --oneline HEAD..upstream/main

# Check if user requested check-only mode
if [[ "${1:-}" == "--check" || "${1:-}" == "--check-only" ]]; then
  echo -e "\n${CYAN}Check completed. Run 'bun run sync-upstream' or './scripts/sync-upstream.sh --merge' to pull changes.${NC}"
  exit 0
fi

# 4. Working directory check
if [[ -n "$(git status --porcelain)" ]]; then
  echo -e "\n${RED}Error: Working directory has uncommitted changes.${NC}"
  echo -e "Please commit or stash your changes before syncing with upstream."
  git status -s
  exit 1
fi

# 5. Create backup tag before sync
BACKUP_TAG="we-pre-sync-$(date +%Y%m%d%H%M%S)"
echo -e "\n${CYAN}Creating safety rollback tag: ${BACKUP_TAG}${NC}"
git tag "${BACKUP_TAG}"

# 6. Perform merge
echo -e "${CYAN}Merging upstream/main into ${CURRENT_BRANCH}...${NC}"
if git merge upstream/main -m "merge(upstream): pull latest changes from iofficeai/aionui"; then
  echo -e "${GREEN}✓ Upstream merge completed cleanly.${NC}"
else
  echo -e "\n${RED}Merge encountered conflicts!${NC}"
  echo -e "Please resolve the conflicts in the affected files, then run:"
  echo -e "  git add <resolved-files>"
  echo -e "  git commit -m 'merge(upstream): resolve conflicts with iofficeai/aionui'"
  echo -e "\nTo abort and return to your exact previous state:"
  echo -e "  git merge --abort"
  exit 1
fi

# 7. Run validation suite
echo -e "\n${CYAN}Running validation test suite to verify compatibility...${NC}"
if bunx vitest run tests/unit/features/localModels.test.ts; then
  echo -e "${GREEN}✓ WE Local model and feature tests passed!${NC}"
else
  echo -e "${RED}Warning: Feature tests failed after upstream merge. Review changes.${NC}"
fi

echo -e "\n${GREEN}====================================================${NC}"
echo -e "${GREEN}✓ Upstream synchronization finished successfully!    ${NC}"
echo -e "${GREEN}  Rollback tag: ${BACKUP_TAG}                       ${NC}"
echo -e "${GREEN}====================================================${NC}"
