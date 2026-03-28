---
name: git-workflow
description: Use when making code changes that need to be committed to the repository, and when checking on your open PRs
---

# Git Workflow

## Worktree Isolation

Always work in a git worktree so your changes don't conflict with other agents or the main working tree.

**Before starting any code change:**
```bash
git worktree add /tmp/hive-<your-alias>-<short-desc> -b <your-alias>/<short-desc> main
cd /tmp/hive-<your-alias>-<short-desc>
```

**After committing your work:**
```bash
git push origin <your-alias>/<short-desc>
cd -
git worktree remove /tmp/hive-<your-alias>-<short-desc>
```

## Rules

- Never commit directly to `main` — always use a feature branch
- Branch naming: `<your-alias>/<short-description>` (e.g. `rio/fix-auth-timeout`)
- Clean up your worktree when done
- If your worktree already exists from a previous run, reuse it instead of creating a new one

## PR Lifecycle — You Own It

When you create a PR, you are responsible for driving it to merge. Do not assume someone else will pick it up.

**After creating a PR:**
1. Message the person who assigned the task: "PR ready: <title>, <URL>"
2. Request a code review from a peer engineer (pick someone relevant to the changed code)
3. Request QA verification if the change is user-facing
4. Declare a FOLLOWUP tag (see below) so the system tracks it

**After merge:**
Message QA to verify the fix is live. Your job is done only when QA confirms.

## FOLLOWUP Tags

When you create a PR, delegate work, or make any commitment that needs follow-up, declare a FOLLOWUP tag at the end of your response. The system will automatically check on it with your defined schedule and re-invoke you if it's not done.

**Format:**
```
FOLLOWUP: <description>
| check: <shell command that exits 0 when done, 1 when not done, 2 to skip this check>
| backoff: <comma-separated intervals>
```

**Always provide a `check` command when possible.** When the check exits 0, the follow-up closes automatically with zero token cost. Only omit `check` for subjective evaluations.

**Choose your backoff schedule based on expected resolution time:**
- PR needing review: `10m, 30m, 1h, 4h`
- CI pipeline: `5m, 10m, 30m`
- Waiting on a person for days: `1h, 4h, 1d, 3d`

**Examples:**

After creating a PR:
```
ACTION: Created PR #46 for mobile truncation fix
FOLLOWUP: PR #46 — drive to merge
| check: gh pr view 46 --json state -q 'if .state == "MERGED" then empty else error("open") end'
| backoff: 10m, 30m, 1h, 4h
```

After delegating work:
```
ACTION: Assigned bug #45 to rio
FOLLOWUP: Bug #45 — verify rio submitted PR
| check: gh pr list --search "45" --json number --jq 'if length > 0 then empty else error("none") end'
| backoff: 30m, 1h, 2h
```

Waiting for QA verification (no programmatic check):
```
ACTION: Merged PR #46
FOLLOWUP: PR #46 — QA verification from @tess
| backoff: 1h, 4h, 1d
```

**When you are re-invoked for a follow-up**, you'll see the attempt number, previous results, and how many tries remain. On your **final attempt**, you must make a terminal decision: merge, close, escalate, or cancel. Do not leave things unresolved.
