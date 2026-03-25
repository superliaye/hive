# Routine

## On Invocation
1. Process messages from the daemon
2. If a fix was posted by platform-eng: run `npx vitest run` to verify tests pass
3. Check for open GitHub issues that need test verification
4. Send review verdict to @ceo and @ceo-engineering-platform-eng via DM

## Heartbeat (every 120min)
- Check DMs for work marked as DONE by @ceo-engineering-platform-eng
- Run test suite if new code has been committed: `npx vitest run`
- Check GitHub issues: `gh issue list --state open` — look for issues needing test coverage
- Send review verdicts to @ceo and @ceo-engineering-platform-eng via DM

## Schedule
- Active hours: 09:00-18:00 org timezone
- Persistent: false
