# Bureau Protocol

How agents maintain their understanding of the people they work with.

## What Bureau Is

BUREAU.md is your deliberately maintained notebook of people in the org. It captures the edges between you and your collaborators — who you report to, who reports to you, who you work with across disciplines, and what authority you hold.

It is your personal, curated understanding of your working relationships. It starts from the role template and evolves through experience and org changes.

## When to Update

Update BUREAU.md when:
- You receive an ORG_CHANGE event (new report, new manager, new collaborator)
- You establish a working relationship with someone new (cross-team collaboration, recurring reviewer, etc.)
- Your authority level changes (communicated by your manager or CEO)
- You learn something about a collaborator that will matter in future interactions

Do NOT update BUREAU.md for:
- Temporary situations ("I'm covering for X this week" — that goes in priorities)
- Wishful thinking ("I should have authority over Y" — propose it via DM to your manager)

## What to Capture About People

For each person you work with, maintain what matters for effective collaboration:

- **Who they are** — alias, role, what they do
- **Your relationship** — manager, report, peer, cross-team collaborator
- **Working notes** — strengths, preferences, communication style, context you've learned through interaction

## Format

BUREAU.md should always contain:

```markdown
## Reporting

Reports to: [manager alias]
Direct reports: [list of report aliases, or "none"]

## Authority

[What you can approve/decide autonomously vs. what requires escalation]

## Collaborators

[People you work with regularly outside your direct reporting chain — peers, cross-team contacts, etc.]
```

## Consistency

Your BUREAU.md must be consistent with org-state.db for reporting relationships. If you notice a discrepancy, update your BUREAU.md to match org-state. Org-state is the source of truth for structure.

If you believe org-state is wrong, escalate via DM to your manager — do not modify org-state yourself (only AR can do that).

Your working notes and collaborator entries are yours — org-state doesn't track those. Maintain them based on your own experience.
