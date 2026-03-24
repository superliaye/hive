# Role Templates

Role templates are the DNA of every agent in the organization. When AR instantiates a new agent, it starts from one of these templates.

## Change Policy

**The bar for modifying these files is extremely high.**

Every change here propagates to all orgs and every future agent instantiated from these templates. A poorly worded instruction, an incorrect authority level, or a misaligned soul trait will silently degrade the quality of every agent that inherits it.

Before changing any template:
1. Identify the exact problem the change solves — with evidence
2. Verify the change doesn't break existing agents derived from the template
3. Consider whether the change belongs in the template (global) or in a specific org's override
4. Get explicit approval from the human operator

If in doubt, make the change in the org-specific agent files, not here.

## Structure

Each role template defines the starting configuration for a new agent:
- **Identity** — model, tools, skills, emoji
- **Soul** — core traits, perspective, personality
- **Bureau Template** — authority levels, reporting relationships (parameterized)
- **Routine** — what the agent does on each cycle
- **Priorities Template** — starting priorities (includes onboarding as first task)
- **Elastic Responsibilities** — what this role absorbs when no specialist exists
- **Focus Rules** — when applicable, constraints on attention

## Model Selection Rationale

- **Opus** — judgment-heavy roles: CEO, department heads, PM, PA, designer
- **Sonnet** — execution-heavy roles: software engineers, QA engineers
- AR uses opus because provisioning errors are costly and hard to reverse
