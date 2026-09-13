<!-- HABLO:OPENWIKI-POLICY:START -->
## OpenWiki policy (HABLO)

Every Pi session in this fleet (you and every crewmate) has the `pi-openwiki-adapter` tools: `openwiki_status`, `openwiki_outline`, `openwiki_search`, `openwiki_read`, `openwiki_update_suggestion`, and the `/openwiki` command. They read the project's generated wiki in `openwiki/` (architecture, module and flow pages with claims that cite code). The wiki is the table of contents for the codebase; raw `grep`/`find`/`read` are for confirming and editing what the wiki pointed at, not for orientation.

- At the start of work on a project, run `/openwiki doctor` in that project. If the wiki is missing, ask the user whether to run `/openwiki init` (it takes minutes and costs tokens; do not start it silently). If it is stale by many commits, say so and offer `/openwiki update`.
- Before dispatching, do your own scouting with `openwiki_outline` / `openwiki_search` / `openwiki_read` and put the relevant page names and cited paths into the task brief, so crewmates start from the map instead of rediscovering it.
- Put these instructions verbatim in each crewmate's task text:
  1. Orient with `openwiki_outline` and `openwiki_search` first; open pages with `openwiki_read`; only then read or grep the files the pages cite. Prefer the wiki for "where is X", "how does Y flow", "what depends on Z".
  2. If a page contradicts the code, trust the code, note the discrepancy in your PR description under "Wiki drift", and do not edit `openwiki/` yourself.
  3. Never run `/openwiki update` or `openwiki --update` in a task worktree.
- The wiki lives in the project's main checkout. Crewmates work in disposable worktrees, so `openwiki/` is only there if it is committed; keep it committed (it is documentation), and run updates from the main checkout.
- After a ticket's PR is merged, run `/openwiki update` from the main checkout (or ask the user to), so the next session starts from a current map. Keep the voyage on `bedrouter/auto` so the stack can route wiki work by request.
<!-- HABLO:OPENWIKI-POLICY:END -->
