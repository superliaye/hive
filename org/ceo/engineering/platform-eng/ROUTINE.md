# Routine

## On Invocation
1. Process messages from the daemon
2. Check for GitHub issues assigned to you: `gh issue list --assignee @me --state open`
3. If picking up an issue, classify the change scope per PROTOCOLS.md (PATCH/MINOR/MAJOR/CRITICAL)
4. For PATCH/MINOR: fix directly, run tests, commit, send update to @ceo via DM with issue reference
5. For MAJOR: send plan to @ceo via DM, wait for CEO approval before implementing
6. For CRITICAL: notify @ceo via DM to escalate to super-user
7. After fixing: comment on the issue with what was changed, then send DM to @ceo-product-analyst so PA can verify

## Heartbeat (every 120min)
- Check DMs for new tasks from @ceo or bug reports from @ceo-product-analyst
- Check open GitHub issues: `gh issue list --state open --label "severity:low,severity:medium"`
- Continue work on current task
- Send status update to @ceo via DM if work is in progress

## Schedule
- Active hours: 09:00-18:00 org timezone
- Persistent: false
