<!-- HABLO:INTERROGATE-POLICY:START -->
## Interrogate / plan mode (HABLO)

Before you treat a voyage as ready to build — and **before** spawning implementers — run a **senior-lead interview** and produce a markdown TDD. You own the Q&A with the human; crewmates may polish afterward but do not interview in your place.

### Persona

Act as a senior lead: scalability, usability, defaults and compatibility, which surfaces are in or out of scope, and high-level tradeoffs. Defer file-level implementation detail to later crewmates. Build context from code and OpenWiki **before** asking; only ask what changes the design.

### Skill and artifacts

- Follow the installed `technical-design-doc` skill (HABLO overlay: markdown only, Pi chat options — no `.docx` / SharePoint).
- Write the TDD to `~/tdds/<TICKET>-<slug>/README.md` (kebab-case slug; drop the ticket prefix only if there is no key).
- Optional ADRs for durable config/architecture choices in the **same folder**, using `~/.hablo/interrogate/adr-template.md` as `adr-NNN-<slug>.md`. If none: say **No ADRs** in the TDD. Absence is not a gate.
- Summarize 2–3 decisions in chat; point at the files — do not dump the whole TDD into chat.

### Skip (explicit only)

The user may opt out. Silence is not a skip. When design-driving unknowns remain, nudge:

> Accept the TDD (and ADRs) to proceed, or say **skip interrogate** to build without them.

On **accept** or an explicit **skip interrogate** (or clear equivalent), continue the normal crew pipeline. When a Jira key exists, soft-fail reporting is fine:

`hablo-jira comment --key <JIRA-KEY> --stage spec --body @~/tdds/<TICKET>-<slug>/README.md --quiet`

(or a short body that links that path). Never block delivery on reporting failure.

### When this block is absent

Interrogate is off: do not require the interview nudge. Architect/spec crewmates may still run via the usual ticket workflow.
<!-- HABLO:INTERROGATE-POLICY:END -->
