# WE Upstream Synchronization Guide

This repository is **WE** — a local-first, Apple Silicon-accelerated AI workstation and multi-agent swarm platform.
WE is built upon the open-source foundation of [`iofficeai/aionui`](https://github.com/iofficeai/aionui).

To ensure that WE continuously benefits from upstream bugfixes, agent updates, and protocol enhancements from `iofficeai/aionui` without overwriting or breaking custom WE capabilities, this repository uses a dual-remote Git architecture.

---

## 1. Remote Architecture

| Remote Name    | Repository URL                              | Purpose                                                        |
| -------------- | ------------------------------------------- | -------------------------------------------------------------- |
| **`origin`**   | `https://github.com/Antman1526/AionUi-Twin` | Your private / custom WE repository containing all WE features |
| **`upstream`** | `https://github.com/iofficeai/aionui.git`   | Official open-source AionUi upstream repository                |

You can verify your remotes at any time:

```bash
git remote -v
```

Expected output:

```text
origin    https://github.com/Antman1526/AionUi-Twin (fetch)
origin    https://github.com/Antman1526/AionUi-Twin (push)
upstream  https://github.com/iofficeai/aionui.git (fetch)
upstream  https://github.com/iofficeai/aionui.git (push)
```

---

## 2. 1-Command Upstream Synchronization

We have automated the fetch, merge, and verification process into a single command:

```bash
bun run sync-upstream
```

Or run the script directly:

```bash
bash scripts/sync-upstream.sh
```

### What `sync-upstream` does:

1. **Checks Cleanliness**: Ensures you do not have uncommitted changes in your working tree.
2. **Fetches Upstream**: Downloads all recent commits, branches, and release tags from `upstream/main`.
3. **Displays Ahead/Behind Metrics**: Shows exactly how many commits upstream has released and how many custom WE commits you have.
4. **Creates Rollback Tag**: Generates an automatic local safety tag (`we-pre-sync-YYYYMMDDHHMMSS`) before modifying anything.
5. **Performs 3-Way Merge**: Merges `upstream/main` into your current working branch cleanly.
6. **Runs Feature Verification**: Automatically runs the local model test suite (`tests/unit/features/localModels.test.ts`) to ensure zero regressions.

---

## 3. Check Upstream Status (Without Merging)

If you just want to check if upstream has released new updates without applying them:

```bash
bash scripts/sync-upstream.sh --check
```

This will print the latest upstream commits and notify you whether updates are available.

---

## 4. Conflict Resolution Protocol

Because WE features are cleanly separated into dedicated modules, merge conflicts are rare. If a conflict does occur (typically in `Layout.tsx` or `package.json`):

1. Git will pause and report the conflicted files.
2. Open the conflicted files in your editor, review the diff, and keep both upstream fixes and WE additions:
   - For `Layout.tsx`: Preserve the `<WeLogo />` and Titlebar customizations.
   - For `package.json`: Keep the WE scripts and version configurations.
3. Mark conflicts as resolved:
   ```bash
   git add <resolved-files>
   git commit -m "merge(upstream): resolve conflicts with iofficeai/aionui"
   ```
4. To abort the merge at any time and return to your exact pre-merge state:
   ```bash
   git merge --abort
   ```

---

## 5. Architectural Isolation Rules

To keep future upstream syncs completely effortless, always follow these isolation conventions:

- **Custom Backend Services**: Place in `packages/desktop/src/process/services/localModels/` or self-contained process modules.
- **Custom UI Features**: Place in self-contained component directories (e.g. `packages/desktop/src/renderer/components/AgentWarRoom/`, `Titlebar/HardwareHUD.tsx`, `base/WeLogo.tsx`).
- **Core Modifications**: When modifying shared upstream layout files, label sections with `// === WE Customization ===` to make 3-way diffs obvious.
