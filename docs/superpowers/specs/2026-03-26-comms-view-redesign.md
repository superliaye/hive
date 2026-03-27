# Comms View Redesign

## Summary

Replace the current "Channels" page (flat list of `#dm:ava`, `#dm:hiro`...) with a conversation-oriented "Comms" view that shows real names, roles, message previews, and full bidirectional conversation threads.

## Key Concept: Paired DM Conversations

DM channels in the database are unidirectional inboxes (`dm:hiro` = Hiro's inbox). But conversations are bidirectional. The UI must merge both directions:

**Hiro ↔ Maya** = messages from `dm:maya` where sender=hiro + messages from `dm:hiro` where sender=maya, merged and sorted chronologically.

A conversation pair `A ↔ B` is identified by finding all messages where (channel=`dm:B` AND sender=A) OR (channel=`dm:A` AND sender=B).

## Design

### Layout: Split Pane

- **Left panel (280px)**: Conversation list with search
- **Right panel (flex-1)**: Selected conversation's merged message thread

### Left Panel — Conversation List

- **Search bar** at top, filters by name/alias/content
- **"Direct Messages" section**: One row per unique A↔B pair, sorted by most recent message
  - Two avatar initials side by side (color-coded) + **"Name ↔ Name"** + roles (gray) + timestamp (right-aligned)
  - Second line: `Sender: last message preview...` truncated with ellipsis
  - Unread count badge (amber pill) — not applicable for super-user observer mode, so this may just be total message count or omitted
- **"Group Channels" section** below: same row pattern for non-DM channels
- Active item: left amber border + darker background
- Dimmed items for conversations with no recent activity

### Right Panel — Conversation Thread

- **Header**: both avatars + "Name ↔ Name" + roles + message count
- **Scrollable message list** (merged from both dm: channels, sorted by timestamp):
  - Color-coded avatar initial
  - **Sender Name** (agent color) + role (gray) + timestamp
  - Full markdown-rendered content (using react-markdown, same as current)
- Real-time: new messages via SSE `new-message` event, auto-scroll to bottom
- Empty state when no conversation selected

### Sidebar

- Rename "Channels" → "Comms" in sidebar navigation

### API

- **New `GET /api/comms/conversations`**: Scans all DM channels, identifies unique A↔B pairs, returns:
  - `id`: canonical pair key (e.g. `"hiro:maya"`, alphabetically sorted)
  - `type`: `"dm"` | `"group"`
  - `participants`: `[{ alias, name, role }]` (2 for DMs, N for groups)
  - `lastMessage`: `{ sender, senderName, content, timestamp }`
  - `messageCount`: total messages in the merged conversation
  - Sorted by `lastMessage.timestamp` descending

- **New `GET /api/comms/conversations/:pairId/messages`**: Returns merged messages from both dm: channels for the pair, sorted by timestamp ascending. Each message includes `sender`, `senderName`, `senderRole`, `content`, `timestamp`, `channel` (original channel for reference).

- Agent name/role resolution uses `ctx.orgChart.agents` map.

### Pair Detection Algorithm

1. Query all messages from `dm:*` channels
2. For each message on `dm:X` from sender Y (where Y ≠ X): create pair key `min(X,Y):max(X,Y)`
3. Group messages by pair key
4. For each pair, compute: participants, lastMessage, messageCount

Special case: `super-user` messages on `dm:hiro` create the pair `hiro:super-user`.

### Components

- **`CommsPage.tsx`** — new page component (replaces `ChannelsPage.tsx`)
- **`ConversationList.tsx`** — left panel with search, DM/group sections
- **`ConversationItem.tsx`** — single row in the list (shows A ↔ B)
- **`ConversationThread.tsx`** — right panel message thread with merged messages
- **`useAgentMap.ts`** — existing hook for agent name/role lookup

### What Gets Removed

- `ChannelsPage.tsx`, `ChannelList.tsx`, `ChannelFeed.tsx`, `ChannelMessage.tsx`
- `/channels` route → replaced by `/comms` route

### Out of Scope

- Sending messages from this view (Chat page handles super-user → CEO messaging)
- Filtering by time range (search covers basic needs)
- Thread/reply support (messages are flat per channel)
