# Protocols

Shared rules that all agents must follow. When in doubt, refer to this document.

## Change Scope Classification

Every code change has a scope. The scope determines who can approve and execute it. **All agents must use the same classification** — no agent can unilaterally downgrade a scope.

### PATCH — Auto-fix, no approval needed
- Single file, < 50 lines changed
- Bug fix with clear expected behavior (e.g., wrong query, off-by-one, missing null check)
- CSS/styling fix, copy change, typo
- Test fix that doesn't change behavior
- **Who acts:** Engineer fixes directly, DMs manager when done
- **Example:** "Channel badge count query returns page count instead of message count"

### MINOR — Auto-fix, notify CEO
- Multiple files in the same module (e.g., dashboard component + API route)
- New small feature with bounded scope (e.g., add a column to audit table)
- Refactor within a single module
- Dependency update (non-breaking)
- **Who acts:** Engineer fixes, DMs manager. CEO is notified but doesn't need to approve
- **Example:** "Wire cache token counts into audit display across store + API + component"

### MAJOR — CEO approval required
- Cross-module change (e.g., daemon + dashboard + types)
- Database schema change
- New API endpoint or protocol change
- Change to triage, scoring, or routing logic
- Any change that affects how agents communicate
- **Who acts:** Engineer proposes a plan via DM to CEO. CEO reviews and approves before work starts
- **Example:** "Add new column to audit DB and update all consumers"

### CRITICAL — Super-user approval required
- Architecture change (new module, new system, new data flow)
- Org structure change (new agent, removed agent, changed hierarchy)
- Change to shared protocols (this file)
- External integration (new API, new service)
- Anything that changes how the org itself operates
- **Who acts:** CEO DMs super-user for approval. Super-user decides
- **Example:** "Redesign channel topology from flat to hierarchy-scoped"

### Rules
1. **When in doubt, go up one level.** If you're unsure whether something is PATCH or MINOR, treat it as MINOR.
2. **Scope is about the fix, not the bug.** A CRITICAL bug might have a PATCH fix. A LOW bug might need a MAJOR refactor.
3. **Any agent can flag a scope disagreement.** If PA says PATCH but engineer thinks MAJOR, the higher scope wins and CEO is notified.
4. **Engineers self-classify** when they pick up an issue. If the fix turns out bigger than expected, stop and re-classify before continuing.
5. **Post-fix verification is mandatory.** The reporter (usually PA) must verify the fix by re-running reproduction steps. An unverified fix is not done.

## Issue Lifecycle

```
FOUND → FILED (GitHub issue) → PICKED UP → FIX IN PROGRESS → FIX POSTED → VERIFIED → CLOSED
```

- **FOUND:** PA or any agent discovers an issue
- **FILED:** GitHub issue created with severity, repro steps, expected/actual behavior
- **PICKED UP:** Engineer assigns themselves, classifies change scope
- **FIX IN PROGRESS:** Engineer working. If scope escalation needed, pause and get approval
- **FIX POSTED:** Engineer commits, DMs manager with issue reference
- **VERIFIED:** Reporter re-runs repro steps, confirms fix works
- **CLOSED:** Issue closed on GitHub with verification evidence

## Severity Labels (for GitHub issues)

- `severity:critical` — System down or data loss
- `severity:high` — Core feature broken, workaround difficult
- `severity:medium` — Feature degraded, workaround exists
- `severity:low` — Cosmetic, polish, minor inconvenience
