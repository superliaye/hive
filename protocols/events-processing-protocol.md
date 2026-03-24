# Events Protocol

How agents process, internalize, and clean up events.

## What Events Are

Events are programmatic notifications about things that happened outside of communication channels. They are written by the framework or by AR — never by the agent itself.

Events are NOT messages. Messages come through local slack. Events come from the system.

## Schema

Events live in `agent.db`:

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  processed INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME
);
```

## Event Types

- **ORG_CHANGE** — reporting chain changed. New direct report, new manager, peer added/removed.
- **ROLE_CREATED** — you were just instantiated. First event every new agent receives.
- **SCHEDULED** — a scheduled job triggered (e.g., daily review, weekly report).
- **WEBHOOK** — an external system triggered an event (e.g., CI failed, deploy completed).
- **SYSTEM** — framework-level notification (e.g., daemon restarted, memory re-indexed).

## Processing Events

On every activation, before handling messages:

1. Query unprocessed events: `SELECT * FROM events WHERE processed = 0 ORDER BY created_at`
2. For each event, decide what action to take:
   - **ORG_CHANGE** → update BUREAU.md (new reports, new manager), add priority to 1:1 with new people
   - **ROLE_CREATED** → this is your first cycle. Follow your initial ACTIVE priorities (1:1 with manager and reports)
   - **SCHEDULED** → execute the scheduled task
   - **WEBHOOK** → assess relevance, add priority if action needed
   - **SYSTEM** → acknowledge, no action usually needed
3. Mark processed: `UPDATE events SET processed = 1, processed_at = CURRENT_TIMESTAMP WHERE id = ?`

## Internalization

Processing an event means deciding what it means for you and taking action. Examples:

- ORG_CHANGE (new direct report "005-frontend-eng"):
  1. Update BUREAU.md: add "005-frontend-eng" to direct reports
  2. Add ACTIVE priority: "1:1 with 005-frontend-eng to share context and establish working norms"
  3. Mark event processed

- ROLE_CREATED:
  1. Read BUREAU.md to understand your place in the org
  2. Your PRIORITIES.md already has 1:1 onboarding items (from seed)
  3. Mark event processed

## Cleanup

Processed events are retained for audit. They do not appear in your prompt.

Events older than 30 days and already processed may be archived by the framework.

## Who Writes Events

- **AR** — writes ORG_CHANGE and ROLE_CREATED events during provisioning
- **Framework/Daemon** — writes SCHEDULED and SYSTEM events
- **External integrations** — write WEBHOOK events
- **Agents** — do NOT create events. Agents can only mark their own events as processed. To notify another agent, use local slack.
