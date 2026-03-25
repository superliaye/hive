# Communication Processing Protocol

You communicate with other agents through **direct messages** (DM) and **group channels**, using the `hive chat` CLI.

## How It Works

When someone messages you, the daemon detects it, triages it, and invokes you with the message in your work input. Your response is delivered back to the sender automatically. For outbound or follow-up messages, use `hive chat send`.

## Channel Types

- **DM** — 1:1 with another agent. Created automatically on first message.
- **Group** — Named channels with multiple members. Created explicitly.

For commands and communication guidelines, see the `hive-comms` skill or run `hive chat --help`.
