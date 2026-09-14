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

MODE="merge"
TARGET="upstream/main"

if [[ "${1:-}" == "--check" || "${1:-}" == "--check-only" ]]; then
  MODE="check"
elif [[ -n "${1:-}" ]]; then
  TARGET="${1}"
fi

# 2. Fetch latest upstream commits and tags
echo -e "${CYAN}Fetching latest upstream commits, branches, and release tags...${NC}"
git fetch upstream main --tags

# Resolve target ref
if ! git rev-parse --verify "${TARGET}" >/dev/null 2>&1; then
  if git rev-parse --verify "upstream/${TARGET}" >/dev/null 2>&1; then
    TARGET="upstream/${TARGET}"
  else
    echo -e "${RED}Error: Target '${TARGET}' not found in local or upstream repository.${NC}"
    exit 1
  fi
fi

# 3. Check diff between current HEAD and target
BEHIND_COUNT="$(git rev-list --count HEAD..${TARGET} 2>/dev/null || echo "0")"
AHEAD_COUNT="$(git rev-list --count ${TARGET}..HEAD 2>/dev/null || echo "0")"

echo -e "Upstream Target: ${CYAN}${TARGET}${NC}"
echo -e "Status:"
echo -e "  - Commits in target not in current branch: ${YELLOW}${BEHIND_COUNT}${NC}"
echo -e "  - Custom WE commits ahead of target: ${GREEN}${AHEAD_COUNT}${NC}"

if [[ "${BEHIND_COUNT}" -eq 0 && "${MODE}" != "check" ]]; then
  echo -e "${GREEN}✓ You are fully up to date with ${TARGET}! No new changes to pull.${NC}"
  exit 0
fi

if [[ "${BEHIND_COUNT}" -gt 0 ]]; then
  echo -e "\n${YELLOW}Latest commits available in ${TARGET}:${NC}"
  git log -n 10 --oneline HEAD..${TARGET}
fi

# Check if user requested check-only mode
if [[ "${MODE}" == "check" ]]; then
  if [[ "${BEHIND_COUNT}" -eq 0 ]]; then
    echo -e "${GREEN}✓ Current branch is up to date with upstream/main.${NC}"
  else
    echo -e "\n${CYAN}Check completed. Run 'bun run sync-upstream' to pull changes.${NC}"
  fi
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
echo -e "${CYAN}Merging ${TARGET} into ${CURRENT_BRANCH}...${NC}"
if git merge "${TARGET}" -m "merge(upstream): pull changes from ${TARGET}"; then
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
