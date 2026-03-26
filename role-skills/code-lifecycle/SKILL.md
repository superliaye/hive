---
name: code-lifecycle
description: Use when picking up an issue, implementing a fix, classifying change scope, or reporting completed work
---

# Code Lifecycle

## Scope Classification

Classify every change before starting work. When in doubt, go up one level.

| Scope | What | Approval | After |
|-------|------|----------|-------|
| **PATCH** | Single file, <50 lines, clear fix | None | DM manager when done |
| **MINOR** | Multiple files in same module | None, notify manager | DM manager when done |
| **MAJOR** | Cross-module, schema change, protocol change | CEO approval required | DM plan to manager first |
| **CRITICAL** | Architecture, org structure, external integration | Super-user approval | DM manager to escalate |

If the fix turns out bigger than expected, **stop and re-classify** before continuing.

## Workflow

### 1. Pick up work

Check inbox for tasks from manager. Check GitHub issues:
```bash
gh issue list --assignee @me --state open
```

### 2. Classify scope

Read the issue/task. Determine PATCH/MINOR/MAJOR/CRITICAL.

For MAJOR+: DM your manager with a plan before implementing.

### 3. Implement

**Branching** — always work on a branch, never commit directly to main:
```bash
git checkout -b {your-alias}/{issue-number}-{short-desc}
# e.g., platform-eng/42-fix-parser-timeout
```

**Commits** — your git identity is set automatically by the system. Just commit normally:
```bash
git add <files>
git commit -m "fix: resolve parser timeout on large orgs (#42)"
```
Your commits will be attributed to your agent name (e.g., `Platform Engineer (hive/platform-eng)`). Do NOT change `git config user.name` or `user.email` — the system handles this.

**Tests** — run before every commit:
```bash
npx vitest run
```

### 4. Create a Pull Request

After tests pass, push your branch and open a PR:
```bash
git push -u origin {your-alias}/{issue-number}-{short-desc}
gh pr create --title "fix: resolve parser timeout (#42)" --body "## Summary\n- What and why\n\n## Test plan\n- Tests added/updated"
```

**Rules:**
- Never push directly to `main`. All changes go through PRs.
- Never merge your own PR. Another engineer or QA must review and approve it.
- Never use `--force` push unless explicitly told to by your manager.

### 5. Report

DM your manager with:
```
PR READY: [PR link]
Scope: [PATCH/MINOR/MAJOR]
Changes: [brief summary]
Tests: [pass/fail, any new tests added]
Reviewer needed: [suggest who should review based on area]
```

If tests fail, fix them before reporting. Never report with failing tests.

### 6. Address review feedback

When a reviewer requests changes on your PR:
- Read all feedback before responding
- Fix issues on your branch, push, re-run tests
- Reply to each review comment with what you changed
- DM reviewer confirming fixes are pushed

### 7. Post-merge

After your PR is merged by a reviewer:
- Close the related issue if not auto-closed
- DM your manager confirming completion

## Reviewing Others' PRs

All agents share one GitHub account, so GitHub's built-in approval system won't work. Instead, we use **comment-based review** with thread resolution as the gate.

When asked to review a PR (by manager or another agent):
```bash
gh pr view <number>
gh pr diff <number>
gh pr checks <number>
```

Review checklist:
- Does the code do what the PR description says?
- Are there tests covering the changes?
- Any security issues, bugs, or performance concerns?
- Does it follow existing patterns in the codebase?

```bash
# Post review findings as comments (creates threads that must be resolved before merge)
gh pr comment <number> --body "[your-alias] REVIEW: <findings>"

# If issues found, post specific comments on lines via review
gh pr review <number> --comment --body "NEEDS_WORK: <specific issues>"

# If everything looks good
gh pr comment <number> --body "[your-alias] REVIEW: LGTM — [brief reason]. Resolving threads."
```

**After approving, the reviewer merges** (not the author):
```bash
gh pr merge <number> --squash --delete-branch
```

**You must never merge your own PR.** If you authored it, request a review from someone else. The PR cannot be merged until all comment threads are resolved (enforced by GitHub branch protection).

## GitHub Issue Management

```bash
# List your open issues
gh issue list --assignee @me --state open

# Comment on progress
gh issue comment <number> --body "Fix in progress, scope: MINOR"

# Close when verified
gh issue close <number> --comment "Verified by @qa-eng"
```

## Red Flags — Stop and Escalate

- Change touches code you don't understand — ask before modifying
- Fix requires changing shared protocols or types used by other agents
- Tests pass locally but you suspect they don't cover the change
- You've been working on the same issue for 3+ cycles without progress
