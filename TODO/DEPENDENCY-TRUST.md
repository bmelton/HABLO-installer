# Dependency trust: an unknown package needs a human

> Status: buildable spec, with one section of API shapes written from memory.
> Everything under "Verify before you build" must be checked against the live
> registries before the code depends on it.
>
> This is the `deps.*` rule class of the guard specified in
> [HOOKS.md](HOOKS.md). It shares that engine, that policy file, that audit log,
> and that fail-closed contract. Read HOOKS.md first; this document does not
> repeat the engine, the shim, or the installation.

- [ ] Verify the five registry endpoints and their field names
- [ ] `internal/deps`: the signal set, the threshold evaluation, the verdict reason
- [ ] `internal/deps/registry`: npm, PyPI, Go proxy, crates.io clients, stdlib `net/http`
- [ ] `internal/deps/cache`: on-disk cache with a TTL, and an offline miss that denies
- [ ] `internal/deps/parse`: package-manager command parser, conservative and tested
- [ ] `internal/deps/manifest`: dependency diff for `package.json`, `go.mod`, `requirements.txt`
- [ ] `internal/deps/lock`: is this name already pinned in the project lockfile
- [ ] Wire `deps.*` into `decide`, including the pre-image snapshot for the audit
- [ ] `deps check`, `deps warm`, `deps audit` subcommands
- [ ] Table tests: one fixture per ecosystem, per threshold, plus an offline fixture
- [ ] Add the `guard.deps` block to `hablo.json`, and the lockfiles to `paths.generated`
- [ ] `doctor`: validate `engine.timeoutMs` against `deps.timeoutMs`; list broad allow entries
- [ ] Measure the cold-cache latency per package and set the default timeout from it
- [ ] `README.md`: what gets denied, how to allow a package, how to warm the cache before a flight

## What this is

The fastest way to compromise a machine through an agent is to have it install
something. A package name in a brief, a hallucinated import, a typosquat, or a
fresh malicious release of a package everybody already trusts: all four end with
`npm install` and none of them looks dangerous in a transcript.

This rule class gates the moment a dependency enters a project. A package that is
new, unpopular, deprecated, or unverifiable is denied, and the denial names the
one policy edit that permits it. Adding that entry is the express and specific
human intervention; nothing else bypasses the rule.

The guard does not audit what is already installed. Existing dependencies are the
project's history, and re-litigating them at every tool call would deny ordinary
work. This gates additions.

## When the rule fires

Two triggers, because a dependency arrives two ways.

**A package-manager command through `bash`.** `internal/deps/parse` recognises the
install verbs and extracts the package arguments:

| Ecosystem | Gated | Not gated |
| --- | --- | --- |
| npm, pnpm, yarn, bun | `install <pkg>`, `add <pkg>`, `i <pkg>` | bare `install`, `ci`, `run`, `test` |
| Python | `pip install <pkg>`, `pip install -r <file>`, `uv add <pkg>` | `pip install -e .`, `pip download` |
| Go | `go get <module>` | `go mod download`, `go mod tidy`, `go build` |
| Rust | `cargo add <crate>` | `cargo build`, `cargo update` |

A bare `npm install` or a `go mod tidy` resolves what the project already
declares, so it adds nothing new and passes. `pip install -r <file>` expands to
every requirement in that file.

**Decision: an unparsable install command denies.** When the parser sees an
install verb but cannot resolve the argument list with confidence (a shell
variable, a command substitution, a pipe into the package manager), the verdict is
deny with a reason that says the command could not be read. The alternative is a
parser that guesses, and a guessing guard is worse than no guard. The remedy is to
run the install with literal package names.

**A write or an edit to a manifest.** The engine diffs the dependency sections of
the new content against the file on disk, and evaluates every added name.

v1 covers `package.json`, `go.mod`, and `requirements.txt`, which the standard
library parses without help. `Cargo.toml` and `pyproject.toml` are TOML, and Go
has no TOML parser in the standard library, so **v1 gates those two ecosystems on
the `bash` trigger only**. That gap is real: an agent that edits `Cargo.toml`
directly and then runs `cargo build` adds a dependency this rule never saw. Close
it with `github.com/BurntSushi/toml` when the gap costs more than the dependency,
and get approval before adding it.

### What is already trusted

A name already pinned in the project lockfile passes without a registry call. The
lockfile is a record of what a human or a package manager already resolved, and
re-checking it would deny a reinstall on a new machine.

That trust holds only because the model cannot write a lockfile. Add the lockfiles
to `paths.generated` in the guard policy, alongside `package-lock.json` which is
already there:

```
**/yarn.lock   **/pnpm-lock.yaml   **/bun.lockb   **/go.sum   **/Cargo.lock   **/poetry.lock   **/uv.lock
```

Without that, an agent forges an entry and grants itself trust.

## The signals

No composite score. Each threshold is evaluated separately, and the deny reason
names the threshold that failed and the value that failed it. A number a human can
check beats a score nobody can argue with.

| Signal | Default threshold | What it catches |
| --- | --- | --- |
| Package age | `minPackageAgeDays: 90` | A name registered last week. Typosquats and throwaway malware. |
| Version age | `minVersionAgeDays: 7` | A fresh release of a package that is otherwise trusted. This is the shape of the real supply-chain attacks: `event-stream`, `ua-parser-js`, `xz`. |
| Monthly downloads | `minMonthlyDownloads: 1000` | A package nobody else uses. |
| Deprecated or yanked | deny | A maintainer already said not to use it. |
| Repository link | `requireRepository: false` | A package with no source to read. Off by default; it denies a surprising number of legitimate packages. |

**A signal the ecosystem cannot provide is skipped, not failed.** The Go module
proxy publishes no download count, so `minMonthlyDownloads` does not apply to a Go
module, and the audit line records which signals were evaluated. This is different
from a registry that cannot be reached, which denies. Keep the two apart in the
code and in the reason text, because a user who reads "denied: no download data"
for a Go module will conclude the guard is broken.

### Version ranges

A request that names an exact version is evaluated against that version. A request
that names a range or no version at all is evaluated against the registry's
current `latest`, because that is what a fresh install resolves to in practice.
The imprecision is real and one-directional: a range that resolves to an older
version than `latest` is judged more harshly than it deserves. Full semver range
resolution needs a range parser per ecosystem, and it is not worth it before the
guard is in daily use.

## Offline, and the cache

**Decision: no trust data means no trust.** A cache miss with no reachable
registry is a deny. The remedy in the reason names both ways out:

```
guard: deps.unverifiable: cannot reach registry.npmjs.org to check "fastify@5.2.0"
  (dial tcp: no route to host). An unverifiable package is denied.
  To allow it: add {"ecosystem":"npm","name":"fastify","version":"5.2.0",
  "note":"…","added":"2026-09-13"} to guard.deps.allow in hablo.json and re-run
  the installer. To work offline later: run `hablo-guard deps warm npm fastify`
  while you have a connection.
```

`deps warm` is what you run before a flight. It takes names, or `--from <manifest>`
to warm everything a project already declares.

Cache layout, under `engine.cacheDir`:

```
~/.hablo/guard-cache/deps/
  npm/fastify.json          { fetchedAt, packageCreated, latest, versions{v:published},
                              monthlyDownloads, deprecated, repository }
  go/github.com!s!spf13!cobra.json
  pypi/httpx.json
  cargo/serde.json
```

The name is escaped for the filesystem the way the Go module proxy escapes it (an
uppercase letter becomes `!` plus its lowercase form), so one rule covers every
ecosystem. A cache entry older than `cacheTtlHours` (default 24) is refetched, and
a refetch that fails while a stale entry exists **uses the stale entry and records
`stale: true` in the audit line**. Stale data is still evidence; the deny is for
no data at all.

### Latency, and the engine timeout

A cold cache costs one HTTPS round trip per package, sometimes two when downloads
come from a second endpoint. HOOKS.md sets `engine.timeoutMs` to 3000, which is
below that budget.

**`doctor` fails when `deps.enabled` is true and `engine.timeoutMs` is less than
`deps.timeoutMs + 1000`.** The recommended pair is `deps.timeoutMs: 4000` and
`engine.timeoutMs: 8000`. A timeout in the engine denies, so a misconfigured pair
turns every install into a deny with a confusing reason.

## Transitive dependencies

The guard sees `npm install fastify`. It does not see the ninety packages that
come with it, and no threshold on the direct name says anything about them.

**Decision: an advisory post-install audit, not a block.** `decide` records a
pre-image of the project lockfile for an allowed install command. After the
command returns, the shim runs `hablo-guard deps audit --project <dir>
--pre <id>`, which diffs the lockfile and reports every newly added name that
fails a threshold. The findings go back to the model on the same turn, the same
way the post-edit checks do, and the audit log keeps the list.

Blocking here is the wrong shape: the packages are already on disk by the time the
lockfile changes, so a deny would be theatre. The honest version is a report that
names what arrived, so a human reviewing the pull request sees it.

## Policy

An additional block inside `guard`. The installer renders it with everything else.

```jsonc
{
  "guard": {
    "deps": {
      "$comment": "Gates a dependency entering a project. Signals come from the registries and are cached under engine.cacheDir. An unverifiable package is denied; guard.deps.allow is the only bypass, and every entry needs a note.",
      "enabled": true,
      "interactive": false,
      "timeoutMs": 4000,
      "cacheTtlHours": 24,
      "minPackageAgeDays": 90,
      "minVersionAgeDays": 7,
      "minMonthlyDownloads": 1000,
      "denyDeprecated": true,
      "requireRepository": false,
      "ecosystems": ["npm", "pypi", "go", "cargo"],
      "audit": { "enabled": true, "onNewTransitive": "warn" },
      "allow": [
        {
          "ecosystem": "npm",
          "name": "@earendil-works/pi-coding-agent",
          "version": "*",
          "note": "the Pi SDK; every extension in this repository imports its types",
          "added": "2026-09-13"
        }
      ]
    }
  }
}
```

**Decision: `deps` carries `"interactive": false`.** A captain cannot approve a
package in the moment. Installing a dependency is a reviewable decision with a
long tail, and the thirty seconds it takes to add an allow entry with a note is
the review. This is the rule the whole class exists for, so it does not get a
dialog.

An allow entry needs `ecosystem`, `name`, `version`, and a non-empty `note`;
`doctor` rejects the block otherwise. `"version": "*"` is permitted and is listed
separately in `doctor` output under "broad allow entries", because an entry that
trusts every future release of a package is exactly the thing a compromised
release walks through.

## The registries

Written from memory. Every row is a checklist item.

| Ecosystem | Metadata | Downloads |
| --- | --- | --- |
| npm | `GET https://registry.npmjs.org/<name>`: `time.created`, `time.<version>`, `versions.<v>.deprecated`, `repository.url` | `GET https://api.npmjs.org/downloads/point/last-month/<name>`: `downloads` |
| PyPI | `GET https://pypi.org/pypi/<name>/json`: `info.yanked`, `info.project_urls`, `releases.<v>[].upload_time_iso_8601` | `GET https://pypistats.org/api/packages/<name>/recent`: `data.last_month` |
| Go | `GET https://proxy.golang.org/<escaped>/@v/list`, then `/@v/<version>.info`: `Time` | none published |
| Rust | `GET https://crates.io/api/v1/crates/<name>`: `crate.created_at`, `crate.recent_downloads`, `versions[].yanked`, `versions[].created_at` | same response |

`api.deps.dev` offers all four ecosystems behind one schema and adds an OpenSSF
scorecard. **Decision: the native registries are the source in v1.** One
third-party aggregator in the deny path of every install is a single point of
failure and a single point of trust, and the native endpoints are the data the
aggregator itself reads. Revisit if maintaining four clients proves worse than
depending on one.

Every client sends a `User-Agent` of `hablo-guard/<version>`, honours
`deps.timeoutMs`, retries nothing, and treats any non-200 as unreachable.

**Privacy, stated once:** the guard sends package names to the public registries.
Those names say what you are building. The requests are indistinguishable from the
package manager's own requests to the same hosts, which is why this is acceptable;
it is not zero.

## What this cannot see

- A package installed by a script the agent runs, a `Makefile` target, a
  `postinstall` hook, or a Dockerfile.
- A dependency added to `Cargo.toml` or `pyproject.toml` by a file edit, until the
  TOML gap above is closed.
- A malicious version of a package that is old, popular, and not yet deprecated.
  Age and popularity are proxies for review, and a proxy fails when the attacker
  waits.
- Anything inside a package. This rule gates the decision to depend, not the code
  that arrives.

Write these in `README.md` next to the rule. A guard whose limits are undocumented
gets trusted for things it does not do.

## Verify before you build

1. Every field name in the registry table. Four `curl` calls and a careful read.
2. `pypistats.org` rate limits and whether it needs a header. If it is unusable,
   PyPI loses the download signal and that threshold is skipped for PyPI, which is
   the "signal unavailable" path, not a deny.
3. The Go proxy escaping rule for an uppercase module path, against a real module.
4. That `npm install` with no arguments never reaches the parser's install branch,
   including `npm i`, `npm install --production`, and `npm install --workspaces`.
5. Cold-cache latency for one package on each registry. The `deps.timeoutMs`
   default comes from that measurement, not from this document.
