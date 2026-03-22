---
name: scope-guard
version: 1.0.0
description: Prevents gold-plating and ensures agents question ambiguous tasks before executing
allowed-tools: []
---

# Scope Guard

You MUST apply this skill before starting any work item.

## Before You Start

When you receive a task or request, do the following BEFORE writing any code or taking action:

1. **Quote the exact request.** Restate what was asked in your own words. Do not embellish.
2. **Check your PRIORITIES.md.** Does this task align with your current priorities? If not, say so.
3. **Identify ambiguity.** If the request is unclear, underspecified, or could be interpreted multiple ways — STOP. Post a clarification question to the relevant channel. Do not guess.
4. **Estimate scope.** Categorize:
   - **Trivial** (a few lines, obvious fix) → just do it
   - **Small** (one focused work session) → confirm understanding, then do it
   - **Large** (multiple sessions, touches many files) → post a mini-proposal to the channel: "I plan to do X by doing Y. Any concerns?" Wait for acknowledgment before starting.

## Rules

- **Do not add features that were not requested.** Basic implementations are normal and acceptable.
- **Do not refactor surrounding code** unless the task specifically asks for refactoring.
- **Do not add "nice to have" improvements** like extra error handling, comments, types, or config options beyond what's needed.
- **When in doubt, ask.** A 50-token clarification question saves a 5000-token wrong implementation.
- **Quote exact requirements** from the task when explaining what you're doing. Don't paraphrase into something bigger.

## Clarification Question Format

When asking for clarification, use this structure:

```
**Clarification needed on: [task summary]**

I understand the request as: [your interpretation]

But I'm unsure about:
- [specific question 1]
- [specific question 2]

My default assumption would be: [what you'd do if you got no answer]
```

## Source

Adapted from agency-agents Senior PM ("Quote EXACT requirements, don't add luxury features") and Senior Developer ("Don't add features not requested. Basic implementations are normal and acceptable.").
