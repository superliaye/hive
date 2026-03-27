---
name: spec-writing
description: Use when defining a feature, change, or fix before engineering work begins. Produces specs engineers can build from without guessing.
---

# Spec Writing

A spec answers three questions: What are we building? Why? How do we know it's done?

If engineers have to ask clarifying questions after reading your spec, the spec failed.

## Spec Structure

### 1. Problem
What's broken or missing? Who is affected? Evidence (bug reports, user feedback, metrics).

Do NOT start with the solution. Start with the problem.

### 2. Proposed change
What the user will experience after this ships. Write it as user-visible behavior, not implementation details.

Bad: "Add a POST /api/users endpoint"
Good: "Users can create an account with email and password. They see a confirmation screen and receive a welcome email."

### 3. Acceptance criteria
Concrete, testable conditions. An engineer reads these and knows exactly when they're done.

```
- [ ] User can submit the form with valid email + password
- [ ] Invalid email shows inline error "Please enter a valid email"
- [ ] Password under 8 chars shows "Password must be at least 8 characters"
- [ ] Successful signup redirects to /welcome
- [ ] Duplicate email shows "An account with this email already exists"
```

### 4. Out of scope
What this spec intentionally does NOT cover. Prevents scope creep.

### 5. Edge cases
Things that could go wrong. The engineer should handle these, but you need to identify them:
- What if the user is already logged in?
- What if the email service is down?
- What if they navigate away mid-flow?

### 6. Open questions
Things you haven't decided yet. Flag them explicitly rather than leaving ambiguity.

## Filing the spec

Create a GitHub issue:
```bash
gh issue create --title "[spec] <feature name>" --label "spec" --body "<full spec>"
```

DM your manager: `SPEC READY: <issue link> — ready for engineering`

## Quality check

Before filing, verify:
- [ ] Problem section has evidence, not just opinion
- [ ] Acceptance criteria are testable (yes/no, not subjective)
- [ ] Edge cases are listed — at least 3
- [ ] Out of scope is explicit
- [ ] An engineer can build this without asking you questions
