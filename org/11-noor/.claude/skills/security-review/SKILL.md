---
name: security-review
description: Use before submitting a PR or when reviewing code that handles user input, auth, data access, or external integrations.
---

# Security Review

Run this checklist before every PR that touches user input, authentication, data access, or external integrations. Takes 5 minutes. Catches the bugs that cost months.

## Checklist

### Input & Injection
- [ ] All user input is validated/sanitized before use
- [ ] SQL queries use parameterized statements, never string concatenation
- [ ] HTML output is escaped to prevent XSS
- [ ] File paths from user input are sanitized (no path traversal: `../`)
- [ ] Command execution never includes unsanitized user input
- [ ] JSON/YAML parsing handles malformed input gracefully

### Authentication & Authorization
- [ ] Auth checks exist on every protected route/endpoint
- [ ] Authorization verifies the user can access *this specific resource*, not just "is logged in"
- [ ] Tokens/sessions have expiration
- [ ] Password handling uses proper hashing (bcrypt/argon2), never plaintext or weak hashing
- [ ] Failed auth attempts don't leak information (same error for wrong user vs wrong password)

### Data & Secrets
- [ ] No secrets (API keys, passwords, tokens) in source code
- [ ] Environment variables used for configuration, not hardcoded values
- [ ] `.env` files are in `.gitignore`
- [ ] Logs don't contain sensitive data (passwords, tokens, PII)
- [ ] Error messages don't expose internal details to users

### Dependencies & Infrastructure
- [ ] No known vulnerable dependencies (`npm audit`)
- [ ] External API calls have timeouts
- [ ] File uploads are size-limited and type-checked
- [ ] Rate limiting exists on public-facing endpoints

### Data Flow
- [ ] Sensitive data is encrypted in transit (HTTPS)
- [ ] Database queries are scoped to the authenticated user's data
- [ ] Bulk operations have limits to prevent resource exhaustion
- [ ] Deletion is soft-delete or has confirmation where appropriate

## How to use

Before submitting your PR, run through the relevant sections. Not every item applies to every change — use judgment. But if your change touches auth, input handling, or data access, the corresponding section is mandatory.

If you find an issue:
1. Fix it before submitting the PR
2. Add a test that verifies the fix
3. Note it in the PR description: "Security: fixed [issue] in [area]"

If you find an issue you can't fix (e.g., architectural):
```bash
gh issue create --title "[security] <description>" --label "security" --body "## Risk\n<what could happen>\n\n## Location\n<file:line>\n\n## Suggested fix\n<approach>"
```
