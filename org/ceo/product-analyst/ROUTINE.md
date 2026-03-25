# Routine

## On Invocation

Process messages from the daemon, then execute the relevant review cycle.

## Daily Product Review

When triggered by routine or CEO request, run through this checklist:

### 1. System Health
- [ ] Run `hive status` — all agents showing correct status?
- [ ] Check agent idle times — are they reasonable or all "just now"?
- [ ] Run `hive memory status` — are all agents indexed with chunks > 0?

### 2. Dashboard Visual Review (Playwright)
- [ ] Navigate to dashboard home page, take screenshot
- [ ] Check: do agent cards show correct status, tokens, idle times?
- [ ] Check: does chat activity show recent messages with correct timestamps?
- [ ] Navigate to audit page, take screenshot
- [ ] Check: are action summaries populated? Are token counts non-zero?
- [ ] Navigate to org page, take screenshot
- [ ] Check: does the org tree render correctly? Are all agents present?

### 3. User Flow Exercise
- [ ] Send a test message via CLI: `hive chat send --to ceo --as super-user "status update please"`
- [ ] Wait, then check if CEO responds via DM
- [ ] Observe the delegation chain — does CEO delegate to engineers via DMs?
- [ ] Take screenshot of chat activity after response arrives

### 4. Memory System
- [ ] Run `hive memory search <agent> <query>` for 2-3 agents
- [ ] Check: are results relevant to the query? Do scores vary?
- [ ] Check: do daily logs get indexed after new messages?

### 5. File Findings
For each issue found:
- [ ] Write spec to `specs/YYYY-MM-DD-<slug>.md` with repro steps, expected/actual, severity
- [ ] File GitHub issue: `gh issue create --title "<title>" --body "$(cat specs/<file>)" --label "severity:<level>"`
- [ ] For LOW/MEDIUM: send issue link to @ceo-engineering-platform-eng via DM — engineers auto-fix per PROTOCOLS.md
- [ ] For HIGH: send to @ceo via DM with recommendation — CEO decides routing
- [ ] For CRITICAL: send to @ceo via DM — CEO escalates to super-user
- [ ] Update PRIORITIES.md with new findings

## Fix Verification

When an issue is marked fixed (engineer sends DM or closes GitHub issue):
1. Read the original bug report from `specs/`
2. Run the exact reproduction steps from the spec
3. Take new screenshots if UI-related
4. Compare before/after
5. If fixed: close GitHub issue with `gh issue close <number> --comment "Verified: <evidence>"`
6. If not fixed: reopen with `gh issue reopen <number> --comment "Still broken: <evidence>"`
7. Send result to @ceo and @ceo-engineering-platform-eng via DM: VERIFIED or STILL BROKEN

## Schedule
- Active hours: 09:00-18:00 org timezone
- Persistent: false
