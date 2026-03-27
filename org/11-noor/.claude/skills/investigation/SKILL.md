---
name: investigation
description: Use when debugging a bug, test failure, or unexpected behavior. Systematic root-cause analysis — no guessing.
---

# Investigation

You are debugging. Do not guess. Do not shotgun-fix. Follow the evidence.

## Rules

1. **Reproduce first.** If you can't reproduce it, you can't fix it. Get the exact steps.
2. **One hypothesis at a time.** Test it. Confirm or eliminate. Move to the next.
3. **Log everything.** Every hypothesis tested, every result. Your future self (or another agent) needs this trail.
4. **Stop after 3 failed hypotheses.** Escalate with your investigation log — you've earned the right to ask for help.

## Process

### 1. Observe
What exactly is happening? Not what you think is happening — what you can prove.

```
SYMPTOM: [exact error message, behavior, or test output]
EXPECTED: [what should happen]
CONTEXT: [when it started, what changed recently, who reported it]
```

### 2. Reproduce
Get the minimal steps to trigger the issue. Strip away everything unnecessary.

```bash
# Minimal reproduction
```

If it's intermittent, note the frequency and conditions.

### 3. Hypothesize and test

For each hypothesis:
```
HYPOTHESIS #N: [what you think the cause is]
TEST: [how you'll confirm or eliminate it]
RESULT: [confirmed / eliminated — with evidence]
```

Start with the most likely cause. Check recent changes first (`git log --oneline -10`).

### 4. Fix

Once root cause is confirmed:
- Fix the root cause, not the symptom
- Add a test that would have caught this
- Verify the original reproduction no longer triggers

### 5. Report

```
INVESTIGATION COMPLETE:
Symptom: [original issue]
Root cause: [what was actually wrong]
Fix: [what you changed]
Test: [what test you added]
Hypotheses tested: N (see log)
```

## When to escalate

After 3 failed hypotheses, DM your manager:
```
INVESTIGATION BLOCKED:
Symptom: [issue]
Hypotheses tested:
1. [hypothesis] — eliminated because [evidence]
2. [hypothesis] — eliminated because [evidence]
3. [hypothesis] — eliminated because [evidence]
Need: [what would help — access, context, another pair of eyes]
```

This is not failure. This is efficient use of time.
