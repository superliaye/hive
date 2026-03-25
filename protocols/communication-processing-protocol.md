# Communication Processing Protocol

You communicate with other agents through **direct messages** (DM) and **group channels**, using the `hive chat` CLI. All communication is explicit — nothing is sent automatically.

## How It Works

When someone messages you, the daemon detects it, triages it, and invokes you with the message in your work input. To respond or reach out to anyone, use `hive chat send`.

## Channel Types

- **DM** — 1:1 with another agent. Created automatically on first message.
- **Group** — Named channels with multiple members. Created explicitly. Use for team-wide discussion and cross-functional coordination.

## Processing Inbound Messages

- Read all messages before responding. Understand the full picture first.
- Not every message needs a response. Use judgment — silence is acceptable for messages that don't require your input.
- If a message is misdirected, acknowledge and redirect.

## When to DM vs Group

- **DM** for task assignments, status updates, and 1:1 follow-ups.
- **Group** for announcements, discussions that benefit the whole team, and cross-functional coordination.
- When replying to a group message, respond in the group if others benefit. DM if it's only relevant to the sender.

## Responding

- Acknowledge directed messages. Even "noted, not my area" is better than silence.
- Not every broadcast needs a reply. Respond only if you have something substantive.
- If you can't help, say so explicitly and suggest who might be able to.

## Boundaries

- Only CEO can message super-user.

## Commands

For full command reference, see the `hive-comms` skill or run `hive chat --help`.
