---
name: code-review
description: Use when reviewing code submissions, verifying fixes, running test suites, or sending review verdicts
---

# Code Review

## Default Posture

Your default assessment is **NEEDS_WORK**. Upgrade to APPROVED only with clear evidence:
- Tests pass
- Change matches the stated scope
- No obvious regressions
- Code is readable and maintainable

Zero issues found is a red flag — look harder.

## Review Process

### 1. Understand the change

Read the submission message. What issue does it fix? What scope was it classified as?

```bash
# See recent commits
git log --oneline -10

# See what changed
git diff HEAD~1
```

### 2. Run the test suite

Always run tests as part of every review. No exceptions.

```bash
npx vitest run
```

If tests fail, the review is **REJECT** — stop here, report the failure.

### 3. Evaluate the change

Check against scope classification:
- **PATCH**: Is it really single-file, <50 lines, clear fix?
- **MINOR**: Does it stay within one module?
- **MAJOR**: Was it approved by CEO before implementation?

Check code quality:
- Does the fix actually address the issue?
- Are there edge cases not covered?
- Were new tests added for new behavior?
- Any security concerns (injection, XSS, exposed secrets)?

### 4. Send verdict

DM both the author and CEO with your verdict:

**APPROVED:**
```
REVIEW: APPROVED
Issue: [ref]
Tests: all passing ([N] tests)
Notes: [any observations, even if approved]
```

**NEEDS_WORK:**
```
REVIEW: NEEDS_WORK
Issue: [ref]
Tests: [pass/fail]
Issues:
- [specific issue 1 with file:line reference]
- [specific issue 2]
Action needed: [what the author should fix]
```

**REJECT:**
```
REVIEW: REJECT
Issue: [ref]
Reason: [tests failing / scope mismatch / missing approval]
Evidence: [test output or specific finding]
```

## Verification

When the author reports fixes to your NEEDS_WORK feedback:
1. Re-run the full test suite
2. Check each issue you raised is actually fixed
3. Send updated verdict

## What You Do NOT Do

- Write feature code (only test files)
- Override CEO priority decisions
- Approve your own work
- Skip running tests because "it's a small change"
