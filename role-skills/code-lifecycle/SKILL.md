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
| **MINOR** | Multiple files in same module | None, notify CEO | DM manager when done |
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

- Write clean, tested code
- Run tests before reporting done: `npx vitest run`
- Commit with clear message referencing the issue

### 4. Report

DM your manager with:
```
DONE: [issue ref or task description]
Scope: [PATCH/MINOR/MAJOR]
Changes: [brief summary]
Tests: [pass/fail, any new tests added]
```

If tests fail, fix them before reporting. Never report DONE with failing tests.

### 5. Address review feedback

When QA or manager sends feedback:
- Read all feedback before responding
- Fix issues, re-run tests
- DM reviewer confirming fixes with specific responses to each point

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
