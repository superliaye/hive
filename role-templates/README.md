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

Each role is a folder containing the files that get copied into a new agent's directory on instantiation:

```
role-templates/
├── chief-executive/
│   ├── IDENTITY.md
│   ├── SOUL.md
│   ├── BUREAU.md
│   ├── PRIORITIES.md
│   ├── MEMORY.md
│   └── EVENTS.md
├── agent-resources/
│   └── ...
└── software-engineer/
    └── ...
```

### Files

- **IDENTITY.md** — model, tools, skills, emoji. The agent's capabilities.
- **SOUL.md** — core traits, perspective, personality. How the agent thinks.
- **BUREAU.md** — authority levels, reporting relationships. Parameterized on instantiation.
- **PRIORITIES.md** — starting priorities. Default first priority: 1:1 with manager and all direct reports to establish context.
- **MEMORY.md** — starts empty. Exists so the agent has a place to accumulate knowledge from day one.
- **EVENTS.md** — unprocessed events (org changes, scheduled jobs, webhook triggers). Does not include communications. Programmatically appended by the framework.
