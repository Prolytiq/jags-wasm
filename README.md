# jags-wasm (spike)

Phase 0 of bringing `rjags`/`gemtc` to the Prolytiq in-browser statistics
editor: cross-compile the JAGS MCMC engine (C++/Fortran) to WebAssembly inside
the official webR development container (`ghcr.io/r-wasm/webr:main`), via
GitHub Actions.

JAGS is GPL/open-source — this is cross-compilation of upstream source, no
reverse engineering involved. If the spike proves libjags builds for wasm,
`rjags` (Phase 1) and `gemtc` (Phase 2) follow; otherwise the platform keeps
`netmeta` (frequentist NMA) as the documented alternative.

## Browser e2e

`node tests/browser/e2e-gemtc.mjs --app ~/fts-app` runs the full user journey in
headless Chrome against the live Pages stack, with fts-app's production session
code (install via `runCode`, `library(gemtc)`, `mtc.run` on `smoking`,
`jags.samples.progressive`, workspace save → IndexedDB → reload → restore, an
rjags-dependent CRAN package, a 3-chain binomial random-effects model). `--app`
must be an fts-app checkout with `node_modules` installed; `--phases` picks a
subset. Exits non-zero on any failed assertion; the log lands in
`tests/browser/e2e-run.log`.
