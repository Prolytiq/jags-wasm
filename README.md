# jags-wasm (spike)

Phase 0 of bringing `rjags`/`gemtc` to the Prolytiq in-browser statistics
editor: cross-compile the JAGS MCMC engine (C++/Fortran) to WebAssembly inside
the official webR development container (`ghcr.io/r-wasm/webr:main`), via
GitHub Actions.

JAGS is GPL/open-source — this is cross-compilation of upstream source, no
reverse engineering involved. If the spike proves libjags builds for wasm,
`rjags` (Phase 1) and `gemtc` (Phase 2) follow; otherwise the platform keeps
`netmeta` (frequentist NMA) as the documented alternative.
