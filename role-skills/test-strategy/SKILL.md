---
name: test-strategy
description: Use before reviewing code or writing tests. Map the risk surface first, then test with purpose — not just for coverage numbers.
---

# Test Strategy

Don't test randomly. Map what can break, then test that.

## Before Reviewing Code

Before reading the diff, answer:

1. **What does this change do?** (Read the PR description / issue)
2. **What's the blast radius?** Which parts of the system does this touch?
3. **What's the worst thing that could go wrong?** Data loss? Auth bypass? Silent corruption?
4. **What's the most likely thing to go wrong?** Edge cases the author probably didn't think about?

Write this down. Then read the diff with this map in mind.

## Risk Surface Mapping

For any change, categorize the risk:

| Risk level | What it means | Testing approach |
|------------|---------------|-----------------|
| **Critical** | Data loss, auth bypass, money | Must have tests. Block PR if missing. |
| **High** | Feature broken for users, API contract violated | Should have tests. Flag if missing. |
| **Medium** | Edge case failure, degraded experience | Test if practical. Note if skipped. |
| **Low** | Cosmetic, logging, comments | Visual check sufficient. |

## Test Design

For each risk identified, design a test:

```
RISK: [what could go wrong]
TEST: [how to verify it doesn't]
TYPE: unit | integration | e2e
PRIORITY: must-have | should-have | nice-to-have
```

### What to test
- **Happy path** — does the basic flow work?
- **Boundary conditions** — empty input, max length, zero, negative, null
- **Error paths** — what happens when dependencies fail?
- **State transitions** — does it handle concurrent access, partial failure, retry?
- **Regression** — does the fix actually prevent the reported bug?

### What NOT to test
- Implementation details (private methods, internal state)
- Framework behavior (React renders, Express routing)
- Exact error message strings (brittle)
- Things that can't actually happen given the code path

## Review Verdict Template

```
REVIEW: PR #<number>

Risk assessment:
- Critical: [list or "none"]
- High: [list]
- Medium: [list]

Test coverage:
- Covered: [what's tested]
- Missing: [what should be tested but isn't]
- Verdict: APPROVED / NEEDS_WORK / REJECT

[If NEEDS_WORK or REJECT, specify exactly what tests to add]
```
