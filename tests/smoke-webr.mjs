import { WebR } from 'webr';
import { readFileSync, readdirSync } from 'fs';
const webR = new WebR();
await webR.init();
const shelter = await new webR.Shelter();
const MODDIR = '/tmp/jags-wasm-install/lib/jags/modules';
await webR.evalRVoid('dir.create("/tmp/jags-wasm-install/lib/jags/modules", recursive=TRUE)');
for (const f of readdirSync('/tmp/jsmoke/modules')) {
  if (f.endsWith('.so')) await webR.FS.writeFile(MODDIR + '/' + f, readFileSync('/tmp/jsmoke/modules/' + f));
}
await webR.FS.writeFile('/tmp/rjags-bin.tar.gz', readFileSync('/tmp/jsmoke/rjags-bin.tar.gz'));
await webR.FS.writeFile('/tmp/rjags.so', readFileSync('/tmp/jsmoke/rjags.so'));
const out = (k, t) => { const s = String(t).slice(0, 900); if (s.trim()) console.log(k + ': ' + s); };
const run = async (label, code) => {
  const o = await shelter.captureR(code, { captureConditions: true, captureStreams: true, captureMessage: true });
  for (const e of o.output) out(label + ' [' + e.type + ']', typeof e.data === 'string' ? e.data : '');
  if (o.error) out(label + ' [ERROR]', '(thrown)');
  console.log(label + ' => done');
};
await run('install coda', 'webr::install("coda", repos = "https://prolytiq.github.io/r-wasm-pkgs/", quiet = TRUE)');
await run('untar rjags bin', 'untar("/tmp/rjags-bin.tar.gz", exdir = "/tmp/rjags-lib", tar = "internal")');
await run('overlay .so', 'file.copy("/tmp/rjags.so", "/tmp/rjags-lib/rjags/libs/rjags.so", overwrite = TRUE)');
await run('libpath', '.libPaths(c("/tmp/rjags-lib", .libPaths()))');
await run('library rjags', 'suppressWarnings(library(rjags))');
await run('DLLs', 'cat(paste(names(getLoadedDLLs()), collapse=", "))');

await run('load.module bugs (idempotent)', 'rjags::load.module("bugs")');
await run('toy mcmc', 'm <- rjags::jags.model(textConnection("model { y ~ dnorm(0,1) }"), data = list(), n.chains = 1); update(m, 100); p <- rjags::jags.samples(m, c("y"), 500); cat("y mean:", mean(p$y), "sd:", sd(as.vector(p$y)))');
process.exit(0);
