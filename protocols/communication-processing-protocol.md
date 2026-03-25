# Communication Processing Protocol

How agents process incoming messages. Only loaded when the agent has unread messages.

## Your Messages

When you're activated with unread messages, you see all of them. You decide what's important, what needs a response, and what to ignore. There is no pre-filtering — you are the triage.

## Responding

- Read all messages before responding. Understand the full picture first.
- If you can't help, say so explicitly and suggest who might be able to.
- If the message is misdirected, acknowledge and redirect.
- Not every message needs a response. Use judgment — silence is acceptable for messages that don't require your input.

## Directed vs Broadcast

- **Directed messages** (DMs, messages mentioning you by alias): respond via DM to the sender.
- **Broadcast messages** (team channel, no specific mention): respond on the team channel only if you have something substantive to add. Not every broadcast needs a reply from every agent.

## Sending Messages

For directed communication to a specific agent:
```bash
hive chat send @alias "message"
```

For messages to a group:
```bash
hive chat send #group-name "message"
```

Your identity is injected via environment. No `--as` flag needed.

## Boundaries

- Only communicate with agents in your reporting chain or established collaborators in your BUREAU.md.
- For cross-team communication outside your existing relationships, ask your manager to coordinate.
- Never post to channels you're not a member of.
