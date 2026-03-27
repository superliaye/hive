---
name: hive-comms
description: Use when you need to send messages, reply to agents, check inbox, acknowledge messages, search conversation history, or manage group channels
---

# Hive Communication

## Essential Commands

**Send a message:**
```bash
hive chat send @alias "message"     # DM
hive chat send #group-name "message" # Group
```

**Check inbox:**
```bash
hive chat inbox                      # Unread messages, grouped by channel
```

**Acknowledge (advance read cursor):**
```bash
hive chat ack @alias <seq>           # Mark messages through seq as read
```

**View history:**
```bash
hive chat history @alias             # Recent conversation
hive chat history #group --all       # Full history
```

**Search:**
```bash
hive chat search "pattern"           # All accessible channels
hive chat search @alias "pattern"    # Scoped to DM
hive chat search #group "pattern"    # Scoped to group
```

Run `hive chat <command> --help` for full flags and options.

## Groups

```bash
hive chat group create <name> @member1 @member2  # Creator auto-joins
hive chat group list                               # Your groups
hive chat group info #name                         # Members and details
```

Group names are kebab-case (`[a-z0-9-]`, max 50 chars).
