# Memory

## 2026-03-26 — First day, onboarding

- Manager is @maya (Maya Patel, ID 3). DM channel: dm:3:8
- My agent ID is 8, alias: lena
- No issues claimed yet — capacity is open, waiting for Maya's direction on priorities
- Codebase uses: TypeScript, Vitest, SQLite, Express+React+Vite dashboard
- Key conventions: never write directly to SQLite for messages (use hive post → dashboard API → signalChannel()), parseUtcDatetime() for timestamps, always unwrap JSON envelope from Claude CLI output
- Open issues span: bugs (#13 token counts, #17 dashboard dist, #18 timestamps, #19 per-agent breakdown), infra (#21-26), and dashboard features (#4-11)
