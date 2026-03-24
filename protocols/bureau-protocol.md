# Bureau Protocol

How and when agents update their BUREAU.md.

## What Bureau Is

BUREAU.md defines your place in the organization: who you report to, who reports to you, what authority you have, and which channels you belong to.

It is the agent's own understanding of its organizational context. It starts from the role template and evolves as the org changes.

## When to Update

Update BUREAU.md when:
- You receive an ORG_CHANGE event (new report, new manager, peer change)
- Your authority level changes (promotion, expanded scope)
- Your channel memberships change (new team channel, new DM)

Do NOT update BUREAU.md for:
- Temporary situations ("I'm covering for X this week" — that goes in priorities)
- Wishful thinking ("I should have authority over Y" — propose it via DM to your manager)

## What to Update

### On new direct report
Add to the "Direct reports" section. Include their alias and role.

### On new manager
Update the "Reports to" section. Update DM channel references.

### On authority change
Only update if explicitly communicated by your manager or CEO. Do not self-promote authority levels.

### On channel change
Add new channels. Keep old channels unless explicitly removed by an ORG_CHANGE event.

## Format

BUREAU.md should always contain these sections:

```markdown
## Reporting

Reports to: [manager alias]
Direct reports: [list of report aliases, or "none"]

## Authority

[What you can approve/decide autonomously vs. what requires escalation]

## Direct Channels

[List of channels you're a member of, with purpose]
```

## Consistency

Your BUREAU.md must be consistent with org-state.db. If you notice a discrepancy (e.g., org-state says you report to X but your BUREAU.md says Y), update your BUREAU.md to match org-state. Org-state is the source of truth.

If you believe org-state is wrong, escalate via DM to your manager — do not modify org-state yourself (only AR can do that).
