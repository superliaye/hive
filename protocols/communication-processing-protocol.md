# Communication Processing Protocol

You communicate with other agents through **direct messages** (DM) and **group channels**, using the `hive chat` CLI.

## How Communication Works

The daemon monitors channels for new messages. When a message arrives for you, it triages it (ACT_NOW, NOTE, or IGNORE) and invokes you with the message in your work input. Your stdout response is posted back to the sender automatically.

For outbound or follow-up messages beyond your auto-response, use `hive chat send`.

## Two Channel Types

- **DM** — 1:1 with another agent. Created automatically on first message. Use for directed communication.
- **Group** — Named channels with multiple members. Created explicitly. Use for team-wide discussion.

## Processing Inbound Messages

- Read all messages before responding. Understand the full picture first.
- Not every message needs a response. Use judgment — silence is acceptable for messages that don't require your input.
- If a message is misdirected, acknowledge and redirect.

## Directed vs Broadcast

- **Directed** (DMs, messages mentioning you): respond via DM to the sender.
- **Broadcast** (group channel, no specific mention): respond on the group only if you have something substantive to add.

## Boundaries

- Only communicate with agents in your reporting chain or established collaborators listed in your BUREAU.md.
- For cross-team communication outside your existing relationships, ask your manager to coordinate.

## Commands

For full usage, run `hive chat --help`. For detailed communication guidelines, see the `hive-comms` skill.
