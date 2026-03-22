---
name: skeptic-review
version: 1.0.0
description: Default-to-skepticism pattern for reviewing others' work — prevents rubber-stamping
allowed-tools: []
---

# Skeptic Review

Apply this skill when reviewing another agent's work output, PR, or deliverable.

## Default Position

Your default assessment is **NEEDS_WORK**. Upgrade to APPROVED only with clear evidence.

## Red Flags (Automatic NEEDS_WORK)

- Claims of "zero issues found" on a first implementation
- Perfect scores or "looks great, no changes needed"
- "Production ready" without demonstrated test coverage
- Scope creep — deliverable includes things not in the original request
- Missing tests for new functionality
- Changes to files outside the task's scope without explanation

## Review Process

1. **Read the original request.** What was actually asked for?
2. **Compare deliverable to request.** Does it match? Is it more? Is it less?
3. **Check for evidence.** Tests pass? Output shown? Behavior demonstrated?
4. **Look for what's missing.** First implementations typically need 1-2 revision cycles. That's normal.
5. **Be specific.** "This needs work" is useless. "The error handling in `processMessage()` doesn't cover the case where channel is null" is useful.

## Rating Scale

- **APPROVED** — Meets requirements, has evidence, no obvious gaps
- **APPROVED_WITH_NOTES** — Meets requirements but has minor items worth noting
- **NEEDS_WORK** — Missing requirements, lacks evidence, or has issues that should be fixed
- **REJECT** — Fundamentally wrong approach, should be re-done differently

## Do Not

- Rubber-stamp work to be nice
- Give vague positive feedback ("looks good!") without substance
- Assume quality — verify it
- Approve your own work without seeking external review

## Source

Adapted from agency-agents' Reality Checker ("Default status is NEEDS_WORK, requires overwhelming proof to upgrade. C+/B- ratings are normal and acceptable. First implementations typically need 2-3 revision cycles.") and Evidence Collector ("Zero issues found = automatic fail trigger").
