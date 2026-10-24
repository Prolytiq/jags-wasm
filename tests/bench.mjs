// JAGS wasm benchmark (webr@0.6.0, Node). One variant per process.
// usage: node bench.mjs <label> <rjags_4-16.tgz> <modules-dir> [reps]
// Mirrors the production install path (spike.yml smoke / fts-app
// installJagsPackage): untar into .libPaths()[1], modules written into
// MODDIR as libX.so + X.so, options(jags.moddir) BEFORE library(rjags).
// Never dyn.load rjags.so by hand (RTLD_LOCAL breaks module symbol lookup).
// Prints one "BENCH_JSON {...}" line per test/rep; exits 1 unless every run
// printed MCMC_OK.
import { WebR } from 'webr';
import fs from 'fs';
import { performance } from 'perf_hooks';

const [label, tgz, moddirHost, repsArg] = process.argv.slice(2);
const reps = Number(repsArg || 1);
const MODDIR = '/tmp/jags-wasm-install/lib/jags/modules';

const webR = new WebR();
await webR.init();
const shelter = await new webR.Shelter();
await webR.installPackages(['coda'], { repos: ['https://prolytiq.github.io/r-wasm-pkgs/', 'https://repo.r-wasm.org/'], quiet: true });
await webR.FS.writeFile('/tmp/rjags-install.tgz', fs.readFileSync(tgz));
await shelter.evalR('untar("/tmp/rjags-install.tgz", exdir = .libPaths()[[1]], tar = "internal")');
await shelter.evalR(`options(jags.moddir = "${MODDIR}"); dir.create("${MODDIR}", recursive = TRUE)`);
for (const f of fs.readdirSync(moddirHost)) {
  if (!f.endsWith('.so')) continue;
  const bytes = fs.readFileSync(`${moddirHost}/${f}`);
  await webR.FS.writeFile(`${MODDIR}/${f}`, bytes);
  const alias = f.replace(/^lib/, '');
  if (alias !== f) await webR.FS.writeFile(`${MODDIR}/${alias}`, bytes);
}

const capture = async (code) => {
  const o = await shelter.captureR(code, { captureConditions: false, captureStreams: true });
  return o.output.map((e) => String(e.data)).join('\n');
};

let failed = false;
const setup = await capture(`r <- tryCatch({ suppressWarnings(library(rjags)); cat("modules:", list.modules(), "\\n"); "LOAD_OK" },
  error = function(e) paste("ERROR:", conditionMessage(e))); cat(r, "\\n")`);
console.log(`[${label}] ${setup}`);
if (!/LOAD_OK/.test(setup)) process.exit(1);

// (a) toy: 1 chain, update 1000 + jags.samples 50000
const TOY = `r <- tryCatch({
  set.seed(1)
  m <- jags.model(textConnection("model { y ~ dnorm(0,1) }"), n.chains = 1, quiet = TRUE,
                  inits = list(.RNG.name = "base::Mersenne-Twister", .RNG.seed = 1))
  update(m, 1000, progress.bar = "none")
  s <- jags.samples(m, "y", 50000, progress.bar = "none")
  cat("RESULT y_mean=", sprintf("%.5f", mean(s$y)), " y_sd=", sprintf("%.5f", sd(as.numeric(s$y))), "\\n", sep = "")
  "MCMC_OK"
}, error = function(e) paste("ERROR:", conditionMessage(e))); cat(r, "\\n")`;

// (b) pairwise random-effects meta-analysis, 20 studies, binomial logit,
// 3 chains, 1000 adapt + 4000 burn-in, 20000 samples per chain.
const HIER = `r <- tryCatch({
  dat <- list(N = 20L,
    rc = c(12, 8, 25, 4, 30, 15, 9, 22, 6, 40, 11, 17, 5, 28, 14, 20, 7, 33, 10, 19),
    nc = c(100, 60, 180, 40, 210, 120, 75, 160, 50, 300, 90, 130, 45, 200, 110, 150, 55, 240, 85, 140),
    rt = c(8, 5, 18, 2, 21, 12, 5, 15, 5, 26, 7, 13, 2, 20, 9, 16, 4, 22, 8, 12),
    nt = c(98, 62, 175, 41, 205, 118, 77, 158, 52, 295, 92, 128, 44, 198, 112, 148, 57, 238, 83, 141))
  mod <- "model {
    for (i in 1:N) {
      rc[i] ~ dbin(pc[i], nc[i]); rt[i] ~ dbin(pt[i], nt[i])
      logit(pc[i]) <- mu[i]; logit(pt[i]) <- mu[i] + delta[i]
      mu[i] ~ dnorm(0, 1.0E-4); delta[i] ~ dnorm(d, prec)
    }
    d ~ dnorm(0, 1.0E-4); tau ~ dunif(0, 2); prec <- 1 / pow(tau, 2)
    OR <- exp(d)
  }"
  inits <- lapply(1:3, function(k) list(.RNG.name = "base::Mersenne-Twister", .RNG.seed = k))
  m <- jags.model(textConnection(mod), data = dat, inits = inits, n.chains = 3, n.adapt = 1000, quiet = TRUE)
  update(m, 4000, progress.bar = "none")
  s <- coda.samples(m, c("d", "tau", "OR"), 20000, progress.bar = "none")
  pm <- summary(s)$statistics[, "Mean"]
  cat("RESULT ", paste(sprintf("%s=%.5f", names(pm), pm), collapse = " "), "\\n", sep = "")
  "MCMC_OK"
}, error = function(e) paste("ERROR:", conditionMessage(e))); cat(r, "\\n")`;

for (let rep = 1; rep <= reps; rep++) {
  for (const [name, code] of [['toy', TOY], ['hier', HIER]]) {
    const t0 = performance.now();
    const text = await capture(code);
    const ms = performance.now() - t0;
    const ok = /MCMC_OK/.test(text);
    if (!ok) failed = true;
    const result = (text.match(/RESULT (.*)/) || [, ''])[1].trim();
    console.log(`[${label}] ${name} rep${rep}: ${ms.toFixed(0)} ms ${ok ? 'MCMC_OK' : 'MCMC_FAIL'} ${result}`);
    if (!ok) console.log(text);
    console.log('BENCH_JSON ' + JSON.stringify({ variant: label, test: name, rep, ms, ok, result }));
  }
}
// (c) regression, untimed, must pass: every path that crashed the R process
// under wasm before the finalizer + Fortran hidden-length fixes —
// gc() after a model is dropped (rjags C finalizer), dmnorm/dwish/inverse/%*%
// (bugs LAPACK/BLAS), the conjugate multivariate normal sampler, and a glm
// module logistic regression (glm samplers / CHOLMOD).
const REGRESS = `r <- tryCatch({
  set.seed(2)
  m0 <- jags.model(textConnection("model { y ~ dnorm(0,1) }"), n.chains = 1, quiet = TRUE)
  rm(m0); invisible(gc()); cat("GC_OK\\n")
  mv <- "model {
    for (i in 1:N) { yv[i, 1:2] ~ dmnorm(mu[], Om[, ]) }
    mu[1:2] ~ dmnorm(zero[], I2[, ])
    Om[1:2, 1:2] ~ dwish(I2[, ], 3)
    S <- inverse(Om)
    z[1:2] <- Om %*% mu
  }"
  yv <- cbind(rnorm(30, 1), rnorm(30, -1))
  m <- jags.model(textConnection(mv), data = list(N = 30, yv = yv, zero = c(0, 0), I2 = diag(2)),
                  n.chains = 2, quiet = TRUE)
  update(m, 500, progress.bar = "none")
  s <- jags.samples(m, c("mu", "S", "z"), 2000, progress.bar = "none")
  stopifnot(all(is.finite(s$mu)), all(is.finite(s$S)), all(is.finite(s$z)))
  mu_hat <- apply(s$mu, 1, mean)
  stopifnot(abs(mu_hat[1] - 1) < 0.6, abs(mu_hat[2] + 1) < 0.6)
  cat("MVN_OK mu=", sprintf("%.3f", mu_hat), "\\n")
  load.module("glm", quiet = TRUE)
  x <- seq(-2, 2, length.out = 80); yb <- rbinom(80, 1, plogis(0.5 + 1.5 * x))
  mg <- jags.model(textConnection("model { for (i in 1:N) { y[i] ~ dbern(p[i]); logit(p[i]) <- b0 + b1 * x[i] }
    b0 ~ dnorm(0, 0.01); b1 ~ dnorm(0, 0.01) }"), data = list(N = 80, x = x, y = yb), n.chains = 2, quiet = TRUE)
  update(mg, 500, progress.bar = "none")
  sg <- jags.samples(mg, c("b0", "b1"), 2000, progress.bar = "none")
  stopifnot(is.finite(mean(sg$b1)), mean(sg$b1) > 0)
  cat("GLM_OK samplers:", paste(unique(names(list.samplers(mg))), collapse = ","), " b1=", sprintf("%.3f", mean(sg$b1)), "\\n")
  rm(m, mg); invisible(gc()); cat("GC2_OK\\n")
  cat("RESULT", sprintf("mu1=%.3f mu2=%.3f b1=%.3f", mu_hat[1], mu_hat[2], mean(sg$b1)), "\\n")
  "MCMC_OK"
}, error = function(e) paste("ERROR:", conditionMessage(e))); cat(r, "\\n")`;
{
  const text = await capture(REGRESS);
  const ok = /MCMC_OK/.test(text) && /GC_OK/.test(text) && /GC2_OK/.test(text);
  if (!ok) failed = true;
  console.log(`[${label}] regress: ${ok ? 'MCMC_OK' : 'MCMC_FAIL'}`);
  console.log(text);
}
process.exit(failed ? 1 : 0);
