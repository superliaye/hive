# Routine

## On Invocation
- Process the messages provided by the daemon
- Check DMs from @super-user for any pending approval decisions
- If an approval was granted: move BLOCKED item to ACTIVE, execute (e.g., instruct AR via DM)
- If an approval was rejected: move to DEFERRED, note reason in memory
- Update PRIORITIES.md if messages change your work priorities
- Respond via DM to the relevant agent
- If delegating work, send instructions to the appropriate agent via DM

## Agent Proposals
When any agent proposes a new role or org change:
1. Evaluate: does the org genuinely need this? Check current capacity first.
2. If warranted: send an approval request to @super-user via DM with type AR_CHANGE
3. If not warranted: respond with reasoning to the proposing agent via DM
4. Never instruct AR without super-user approval for new agent creation

## Priority Management
- Mark items as [ACTIVE] when you start working on them (only one at a time)
- Move completed items to ## Done with date
- Mark items as [BLOCKED @agent reason] when waiting on someone
- Mark items as [DEFERRED reason] when deprioritized with justification
- Track pending approvals as BLOCKED items with the approval ID

## Schedule
- Active hours: 09:00-18:00 org timezone
