# VERDICT — GREEN

**JAGS 4.3.1 + rjags 4-16 run inside WebR (browser R).** Verified 2026-10-20 via
`tests/smoke-webr.mjs` (Node + webr 0.6.0) against the Actions artifacts:

```
library(rjags)                 → ok (DLL loads, modules auto-load)
load.module("bugs")            → ok (dlopen via libltdl, side module)
jags.model(dnorm(0,1))         → graph compiled
update(m, 100) + jags.samples  → y mean: -0.0043, sd: 1.03  (correct for dnorm(0,1))
```

## What made it work (the full recipe lives in .github/workflows/spike.yml)

1. **libjags.a + libjrmath.a + 8 module .a**: JAGS cross-compiled with emscripten
   (CC/CXX/FFLAGS lifted from the wasm R Makeconf, forced `-fPIC` everywhere,
   config.sub refreshed, C++17 patches for `std::binary_function`/`bind2nd`).
2. **netlib BLAS + LAPACK 3.12.0** built static with wasm flang (lsame/xerbla
   duplicates removed from the lapack archive).
3. **rjags.so**: rjags built against that prefix with a static `src/Makevars`
   (root configure removed), linked as an emscripten **side module**
   (`-s SIDE_MODULE=1 -s WASM_BIGINT`) with **`-Wl,--whole-archive`** for
   libjags/libjrmath (import-dynamic otherwise skips archive members) and
   **default visibility** (webr-vars.mk's `-fvisibility=hidden` lets the linker
   GC `R_init_rjags`, which silently breaks registration).
4. **Module side modules**: each of the 8 JAGS modules linked as `.so` with
   netlib BLAS/LAPACK **embedded** (importing BLAS from R's libRblas fails on
   symbol ABI), renamed without the `lib` prefix (libltdl's search strips it).
5. **Runtime install**: `webr::install("coda")` from Prolytiq/r-wasm-pkgs +
   untar of the rjags binary tarball (configure-generated `zzz.R` needed for
   `.onLoad` to run).

## What remains for production (Phase 2, mechanical)

- Bake the rjags/ modules into the Prolytiq/r-wasm-pkgs build so `webr::install`
  ships the whole stack; add `gemtc` (pure R on top of rjags) to the package list.
- Platform wiring: /biostatistics downloads the module .so files into the VFS
  module dir before `library(rjags)` (same auto-install hook as #965).
- NMA bayesiana then runs in-browser; netmeta (frequencista) remains shipped.

## Phase 2 progress (2026-10-20, later)

- **Module side modules DEPLOYED**: https://prolytiq.github.io/jags-wasm/modules/
  (libbasemod.so, libbugs.so, libdic.so, libglm.so, liblecuyer.so, libmix.so,
  libmsm.so — all HTTP 200).
- **gemtc 1.1-2 wasm binary BUILT and deployed** via the official
  `r-wasm/actions/build-rwasm` (pkgdepends local ref, PACKAGES index generated).
- **Remaining**: rjags binary itself is not in the Pages repo yet — the
  build-rwasm container has no libjags prefix. Fix (next session): bake the
  JAGS prefix into a custom builder image (FROM ghcr.io/r-wasm/webr:main,
  RUN the build steps, push to GHCR) and pass it as `webr-image:` to
  build-rwasm. Then the platform session adds this Pages URL as a third
  package repo + downloads module .so files into the VFS before
  `library(rjags)`.
