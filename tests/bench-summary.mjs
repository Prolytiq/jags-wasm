// Summarise BENCH_JSON lines (stdin) + sizes.tsv files into a markdown table.
// usage: node bench-summary.mjs <dir-with-<variant>/sizes.tsv> < bench.log
import fs from 'fs';
const dir = process.argv[2];
const rows = fs.readFileSync(0, 'utf8').split('\n').filter((l) => l.startsWith('BENCH_JSON '))
  .map((l) => JSON.parse(l.slice(11)));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const variants = [...new Set(rows.map((r) => r.variant))];
const sizes = (v) => Object.fromEntries(fs.readFileSync(`${dir}/${v}/sizes.tsv`, 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t')));
const med = {};
let out = '| variant | toy median ms | hier median ms | toy runs | hier runs | rjags.so bytes | modules total bytes | posterior means (hier) |\n|---|---|---|---|---|---|---|---|\n';
for (const v of variants) {
  const t = rows.filter((r) => r.variant === v && r.test === 'toy');
  const h = rows.filter((r) => r.variant === v && r.test === 'hier');
  const sz = sizes(v);
  med[v] = { toy: median(t.map((r) => r.ms)), hier: median(h.map((r) => r.ms)) };
  out += `| ${v} | ${med[v].toy.toFixed(0)} | ${med[v].hier.toFixed(0)} | ${t.map((r) => r.ms.toFixed(0)).join(', ')} | ${h.map((r) => r.ms.toFixed(0)).join(', ')} | ${sz['rjags.so']} | ${sz.modules_total} | ${h[0]?.result ?? ''} |\n`;
}
if (med.Oz) {
  out += '\nSpeedup vs Oz (positive = faster):\n\n| variant | toy % | hier % | rjags.so size % | modules size % |\n|---|---|---|---|---|\n';
  const base = sizes('Oz');
  for (const v of variants.filter((x) => x !== 'Oz')) {
    const sz = sizes(v);
    const pct = (a, b) => ((1 - a / b) * 100).toFixed(1);
    const grow = (a, b) => ((a / b - 1) * 100).toFixed(1);
    out += `| ${v} | ${pct(med[v].toy, med.Oz.toy)} | ${pct(med[v].hier, med.Oz.hier)} | +${grow(+sz['rjags.so'], +base['rjags.so'])} | +${grow(+sz.modules_total, +base.modules_total)} |\n`;
  }
}
out += '\nModule side-module sizes (bytes):\n\n';
const mods = Object.keys(sizes(variants[0])).filter((k) => k.endsWith('.so'));
out += `| file | ${variants.join(' | ')} |\n|---|${variants.map(() => '---').join('|')}|\n`;
for (const m of [...mods, 'rjags_4-16.tgz', 'modules_total']) out += `| ${m} | ${variants.map((v) => sizes(v)[m]).join(' | ')} |\n`;
console.log(out);
