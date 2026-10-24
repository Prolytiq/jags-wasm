# Browser e2e: JAGS stack + gemtc on WebR 0.6.0 (2026-10-24)

Harness: `tests/browser/e2e-gemtc.mjs`. It runs headless Chrome through CDP and
bundles the PRODUCTION fts-app code (`src/lib/biostatistics/session.ts`,
`workspace-persist.ts`, `files.ts`) with esbuild. WebR 0.6.0 is copied from
fts-app's `node_modules/webr/dist` and booted the way `useWebR.ts` does it:
`interactive: false`, `evalRVoid(R_BOOTSTRAP)`, then a Shelter. Packages come
from the LIVE hosts (prolytiq.github.io/jags-wasm,
prolytiq.github.io/r-wasm-pkgs, repo.r-wasm.org). Every run uses a fresh Chrome
profile, so IndexedDB and the HTTP cache start empty and are shared only
between the phases of that run.

Re-run with one command:

    node tests/browser/e2e-gemtc.mjs --app ~/fts-app-wt-jags-deps   # or any fts-app checkout with node_modules
    # --phases journey,restore,dependents,binomial (the default)  --pkg bayesmix (the default)

The exit code is 0 only if every assertion passes. The log goes to
`tests/browser/e2e-run.log`. The assertions check real values: d.* are finite,
SD > 0, |d| < 3, d.A.* > 0, two runs agree, mu is close to its true value, and
the restored values are identical to the saved ones.

## Result on the live build after the signature-mismatch fix (4ca5f05 + 2b1eb97)

The live `rjags_4-16.tgz` md5 is `4a03612a9cbf0e7dd4f704f6caa19b8f` (Last-Modified 05:25:43 GMT).
The run used fts-app branch `fix/biostatistics-install-jags-dependents` (PR #1033):
**E2E PASS (journey, restore, dependents, binomial)**.

| Step | Time |
|---|---|
| WebR boot + R_BOOTSTRAP | 0.4–0.9 s |
| `library(gemtc)` via runCode auto-install (coda, igraph, meta, plyr, forcats, Matrix, slam, Rglpk, gemtc, rjags, 7 modules), cold cache | 63.0 s (other runs: 80.2 / 44.6 / 28.9 s, CDN dependent) |
| `mtc.run(smoking, RE, 2 chains, n.adapt 500, n.iter 2000)` | 1.6 s |
| 2nd `mtc.run` + 3rd `mtc.run`, `rm()` + `gc()` x2 | 1.0 s |
| `jags.samples.progressive` 4000 iter, chunk 1000, 2 chains | < 0.1 s |
| Re-install of gemtc after reload (browser HTTP cache warm) | 10.9 s |
| `library(bayesmix)` (installs rjags as a dependency) | 2.9 s |
| 20-study binomial RE model, 3 chains, 500 + 2000 iterations | 0.6 s |

Console evidence (excerpts from `e2e-run.log`):

```
> library(gemtc)
[system] Installing package 'gemtc' from the Prolytiq wasm repository...
[stderr] Loading required package: coda
ASSERT OK: library(gemtc) succeeded through the production auto-install
ASSERT OK: rjags and gemtc namespaces are loaded
> rjags::list.modules()
[1] "basemod" "bugs"
> res <- mtc.run(model, n.adapt = 500, n.iter = 2000)
   Observed stochastic nodes: 50 / Unobserved stochastic nodes: 54 / Total graph size: 1075
> print(round(d_stats, 3))
       Mean    SD
d.A.B 0.482 0.411
d.A.C 0.833 0.247
d.A.D 1.104 0.442
sd.d  0.841 (SD 0.189)
# Published smoking NMA (gemtc vignette, RE): d.A.B ~0.49, d.A.C ~0.84, d.A.D ~1.10
> res2 <- mtc.run(...); print(round(d2, 3))
d.A.B 0.498  d.A.C 0.838  d.A.D 1.098
> res_old <- mtc.run(...); rm(res_old); invisible(gc()); invisible(gc())
gc after dropping a fitted JAGS model: OK
> res3 <- mtc.run(model, n.adapt = 100, n.iter = 500)    # JAGS still samples after the finalizers ran
d.A.B 0.511  d.A.C 0.843  d.A.D 1.168
> smp <- jags.samples.progressive(m, "mu", 4000, chunk = 1000, progress = ...)
[system] Chunk 1/4 (25%) - 1000 iterations
[system] Chunk 2/4 (50%) - 2000 iterations
[system] Chunk 3/4 (75%) - 3000 iterations
[system] Chunk 4/4 (100%) - 4000 iterations
   niter nchain calls    mu
    4000      2     4 1.739        (true mu 1.5; state$jags.progress == c(4000, 4000))
> save_workspace()
persistWorkspace -> Workspace saved locally (15 objects, 349.9 KB) — it will be restored automatically after a page refresh.
ASSERT OK: load_workspace() restores d_means identically (VFS round trip)
===== PHASE restore (page reload, same profile) =====
IndexedDB snapshot for e2e-script: 358343 bytes
restoreWorkspaceIfSaved -> Restored 15 objects from your last local workspace save (10/24/2026, 2:30:32 AM).
d_means: 0.4824508 0.8326760 1.1043883   (identical to the saved values)
> library(gemtc); summary(res)   # restored mtc.result is usable
d.A.B 0.482 d.A.C 0.833 d.A.D 1.104
===== PHASE dependents =====
[console.warning] Requested package rjags not found in webR binary repo.   <- webr::install WARNS, does not throw
> library(bayesmix)
[system] Installing package 'bayesmix' from the Prolytiq wasm repository...
ASSERT OK: bayesmix and rjags namespaces are loaded; JAGS modules fetched
===== PHASE binomial =====
Linked to JAGS 4.3.1 / Loaded modules: basemod,bugs
20-study dbin + logit + dnorm/dunif RE model, 3 chains:  d -0.552 (SD 0.099), tau 0.206   (true d -0.5)
E2E PASS (journey, restore, dependents, binomial)
```

The build before the fix (Pages etag `6adc324f-*`, 04:21 GMT) also passed the
smoking NMA (d.A.B 0.499 / d.A.C 0.836 / d.A.D 1.093) and the 3-chain binomial
RE model in this harness. The "function signature mismatch" trap did not show
up there, because the harness never ran `gc()` after dropping a model. The
`gc()` step was added for the post-fix run.

## Bugs found by the e2e (all in fts-app, fixed in PR #1033)

The same e2e run against `origin/main` (051a3a96) fails as follows:

1. `jags.samples.progressive`: any run with more than one chunk fails after the last chunk with
   `Error: 'as.matrix' is not an exported object from 'namespace:coda'`. `coda::start` and `coda::end` are not exported either.
2. Workspace restore after a refresh never worked. The snapshot is in IndexedDB (199506 bytes), but
   `restoreWorkspaceIfSaved -> null` and `exists("d_means")` is `FALSE`. The cause:
   `getOption("prolytiq.state")$load_workspace` does not exist, because `load_workspace` is attached as `prolytiq:tools`.
3. `library(gemtc)` and `library(bayesmix)` load without rjags. They only call `rjags::`, so rjags was
   not installed until the first sampling call failed (the "rjags namespace loaded" assertion fails).
4. (Task B) For a CRAN package that depends on rjags, webr 0.6.0 `install()` only warns
   "Requested package rjags not found". The fix installs the JAGS packages that the
   DESCRIPTION declares, plus any `loadNamespace` "no package called" dependency, through the
   JAGS recipe, then retries. None of altmeta, pcnetmeta, crossnma or BayesCACE was in
   r-wasm-pkgs PACKAGES during this session (96 packages). repo.r-wasm.org already ships
   bayesmix, bnma, BayesGWQS and others that import rjags, so the e2e uses `bayesmix`. jagsUI
   and BayLum need rjags >= 4-17 and will not load against 4-16.

## Workspace persistence: what was validated

The whole TS path ran unmodified in the browser: `save_workspace()` (R),
`persistWorkspace` to the real IndexedDB (`prolytiq-webr`/`workspaces`), a page
reload, `restoreWorkspaceIfSaved`, and `load_workspace` (R). Nothing was stubbed.
