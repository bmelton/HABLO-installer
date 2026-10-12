---
name: openwiki
description: Use the project's OpenWiki (openwiki/) as a compact codebase table of contents before broad grep or reads. Use when locating files, understanding architecture, or planning code changes.
---

Claude Code has no OpenWiki index tools. Walk the generated wiki with Read / Grep / Glob.

1. Start at `openwiki/` — prefer a quickstart or entrypoint page if present.
2. Follow cross-references to architecture, module, and flow pages.
3. Prefer wiki page file references over broad repository greps for "where is X".
4. Before editing, verify load-bearing signatures and schemas against real source files; the wiki can lag the code.
5. Check `openwiki/.last-update.json` (or similar run record) when freshness matters. Do not run `openwiki --update` inside a disposable worktree; offer update from the main checkout.
6. If a page contradicts the code, trust the code and note wiki drift in the PR description.

This costs more tokens than Pi's `openwiki_*` tools; the instruction is the same.
