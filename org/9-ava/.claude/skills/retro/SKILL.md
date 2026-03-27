---
name: retro
description: Use periodically to reflect on recent work. Identifies patterns, surfaces improvements, and feeds learnings into MEMORY.md.
---

# Retro

Pause and reflect. What worked, what didn't, what should change.

Run this after completing a significant piece of work, at the end of a sprint, or when your manager asks for a status check.

## Process

### 1. Gather evidence

Don't rely on memory. Look at the data:

```bash
# What shipped recently
git log --oneline --since="1 week ago" --author="$(git config user.name)"

# What issues were closed
gh issue list --state closed --since="1 week ago"

# What PRs were merged
gh pr list --state merged --search "author:@me"

# What's still open
gh issue list --label "assigned:{your-alias}" --state open
```

### 2. Assess

Answer honestly:

**What shipped?**
- List completed work with links (PRs, issues)
- Was the scope accurate? Did anything grow beyond the original estimate?

**What got stuck?**
- What took longer than expected? Why?
- What's still blocked? What's needed to unblock it?

**What patterns are emerging?**
- Are the same kinds of bugs recurring?
- Are reviews catching the same issues repeatedly?
- Is any part of the codebase consistently harder to work in?
- Are escalations increasing or decreasing?

**What should change?**
- Process changes: something that would prevent repeated friction
- Tooling gaps: manual steps that should be automated
- Knowledge gaps: areas where you or the team lack context
- Priority shifts: work that should be reprioritized based on evidence

### 3. Update MEMORY.md

Write the durable learnings. Not a diary — just the things that change how you work going forward.

```markdown
## Retro — [date]
- [Pattern observed]: [what to do differently]
- [Decision made]: [why, so future-you understands the context]
- [Process change]: [what changed and why]
```

### 4. Share

DM your manager:
```
RETRO: [period covered]
Shipped: [count] items ([links])
Stuck: [count] items ([brief reasons])
Pattern: [most important observation]
Proposal: [one concrete change to try next cycle]
```

## When to run

- After shipping a major feature
- End of each week (if your manager expects weekly updates)
- When you notice you're repeating the same mistake
- When asked for a status update — don't wing it, run the retro
