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

Each role is a folder containing a gateway config and the prompt files that get copied into a new agent's directory on instantiation:

```
role-templates/
├── chief-executive/
│   ├── config.json     ← gateway reads (never in prompt)
│   ├── IDENTITY.md     ← agent reads (loaded into prompt)
│   ├── SOUL.md
│   ├── BUREAU.md
│   ├── PRIORITIES.md
│   ├── MEMORY.md
│   └── skills/         ← role-specific skills (optional)
├── agent-resources/
│   └── ...
└── software-engineer/
    └── ...
```

### config.json (gateway config — declarative, never in prompt)

Controls how the gateway spawns the agent:

- **name** — display name
- **model** — which Claude model to use
- **emoji** — visual identifier
- **mcp** — MCP servers to enable (e.g. "playwright"). Resolved via `--strict-mcp-config --mcp-config`
- **skills** — skills to load into prompt. Resolved from `role-templates/<role>/skills/` or root `skills/`

### Prompt Files (loaded into agent's system prompt)

- **IDENTITY.md** — who you are, what you do, what you don't do. Brief role description.
- **SOUL.md** — core traits, perspective, personality. How the agent thinks.
- **BUREAU.md** — authority levels, reporting relationships. Parameterized on instantiation.
- **PRIORITIES.md** — starting priorities. Default first priority: 1:1 with manager and all direct reports to establish context.
- **MEMORY.md** — starts empty. Exists so the agent has a place to accumulate knowledge from day one.
