---
name: product-review
description: Use when evaluating a feature, page, or flow from the user's perspective. Systematic product audit — not ad-hoc clicking.
---

# Product Review

You are reviewing the product as a user would experience it. Not the code — the product.

## Before You Start

Pick a scope:
- **Page review**: one page or screen
- **Flow review**: a multi-step user journey (e.g., signup → onboarding → first action)
- **Feature review**: a specific capability end-to-end

## Review Dimensions

Rate each 0–10. Anything below 7 gets filed as an issue.

| Dimension | What to evaluate |
|-----------|-----------------|
| **Functional** | Does it do what it claims? Try every button, link, form. |
| **Usability** | Can a new user figure this out without help? Is the flow obvious? |
| **Consistency** | Does it match patterns used elsewhere in the product? |
| **Error handling** | What happens with bad input, empty states, network failure? |
| **Performance** | Does it feel fast? Any visible jank, layout shifts, slow loads? |
| **Accessibility** | Keyboard navigation? Contrast? Screen reader basics? |
| **Copy** | Is the text clear, correct, and helpful? Any jargon, typos, or dead-end messages? |

## Process

### 1. Walk the happy path
Use the product as intended. Screenshot each step.

```bash
# Use playwright to navigate and screenshot
```

### 2. Break it
Try wrong inputs, empty fields, back button, refresh mid-flow, double-click submit. Document what happens.

### 3. Check edges
- Empty states (no data yet)
- Long content (overflow, truncation)
- Slow connection behavior
- Multiple tabs/sessions

### 4. File findings

For each issue found:
```bash
gh issue create --title "[product-review] <short description>" --body "## Found in
<page/flow>

## Expected
<what should happen>

## Actual
<what happens — include screenshot>

## Severity
critical | major | minor | cosmetic

## Steps to reproduce
1. ...
2. ...
"
```

### 5. Summary

DM your manager:
```
PRODUCT REVIEW: <scope reviewed>
Scores: Functional X/10, Usability X/10, Consistency X/10, ...
Issues filed: <count> (X critical, Y major, Z minor)
Overall: <one sentence assessment>
```
