---
name: comms
version: 1.0.0
description: How to use Hive communication channels — posting, proposing, escalating across the org
allowed-tools: []
---

# Communication Protocol

You communicate with other agents and the super user through **channels**. Every message you post is visible to all members of that channel.

## Your Channels

Check your BUREAU.md for your channel memberships. Common channels:
- **#all-hands** — org-wide announcements (all agents)
- **#board** — CEO <> super-user (CEO only)
- **#approvals** — items requiring super-user sign-off (CEO only)
- **#leadership** — CEO + direct reports
- **Team channels** — your manager + teammates (e.g., #ceo-engineering)

## Posting Messages

Your stdout response is automatically posted to the **same channel** the message came from.

To post to **other channels** (delegation, escalation, cross-team requests), use the `hive post` CLI via Bash:

```bash
hive post --channel ceo-engineering --as ceo "Please investigate the authentication latency issue. The user reported slow login times."
```

- `--channel` is the target channel name (without #)
- `--as` is your agent ID (use your own ID)
- The message is the positional argument
- This triggers the receiving agent immediately via the daemon
- You can post to multiple channels in one invocation

## Proposing Ideas

If you identify something outside your scope — a missing role, a process improvement, a cross-team dependency — **propose it to your manager** via your team channel:

```
**Proposal: [short title]**

Context: [what you observed]
Suggestion: [what should change]
Impact: [why this matters]
```

Your manager decides whether to act, escalate, or defer. You do NOT take action on out-of-scope proposals yourself.

## Responding to Messages

- Always acknowledge messages directed at you
- Use the status-protocol skill for work outputs
- If you can't help, say so explicitly and suggest who might be able to

## Do Not

- Post to channels you're not a member of
- Direct-message agents outside your reporting chain without your manager's knowledge
- Ignore messages — even a "noted, not my area" is better than silence
