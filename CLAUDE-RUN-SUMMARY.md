# jags-wasm — overnight autonomous run summary (2026-10-20)

**VERDICT: GREEN.** JAGS 4.3.1 (MCMC engine, C++/Fortran) + rjags 4-16 run
inside WebR. Verified by tests/smoke-webr.mjs: toy model dnorm(0,1),
100 warmup + 500 samples, posterior mean -0.0043 / sd 1.03 (correct).

Phases: 0 (engine port) ✅ · 1 (rjags build + runtime) ✅ ·
2 (gemtc + platform integration) — next, mechanical.

Key commits: toolchain fixes (config.sub, flang, -fPIC, visibility,
whole-archive, side modules, netlib BLAS/LAPACK static, C++17 patches).
Full recipe: .github/workflows/spike.yml + VERDICT.md.
