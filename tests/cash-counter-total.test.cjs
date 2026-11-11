/* Cash Counter total counts every entry, not just the first 1,000. Run: node tests/cash-counter-total.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync('cash-counter-patch.js', 'utf8');
const code = src.slice(src.indexOf('// The balance is the sum of every entry'), src.indexOf('var _ccLoading = false;'));
const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, amount: i % 10 === 0 ? -50 : 100.5 }));
let calls = 0;
function query() {
  let from = 0, to = 999;
  const q = {
    select() { return q; }, order() { return q; },
    range(a, b) { from = a; to = b; calls++; return Promise.resolve({ data: rows.slice(a, Math.min(b + 1, a + 1000)), error: null }); }, // server caps at 1,000
  };
  return q;
}
const ctx = { db: { from: query }, window: {}, Date, Math, Number };
vm.createContext(ctx); vm.runInContext(code, ctx);
(async () => {
  const expected = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  assert.equal(await ctx.ccSumAllCash(), expected, 'all 2,500 entries counted');
  assert.equal(calls, 3, 'read in pages of 1,000');
  rows.push({ id: 2501, amount: 465 });
  assert.equal(await ctx.ccSumAllCash(), Math.round((expected + 465) * 100) / 100, 'a new cash payment moves the total');
  const day = ctx.ccDayStartIso();
  assert.match(day, /^\d{4}-\d{2}-\d{2}T00:00:00\+05:30$/, 'today starts at midnight India time');
  console.log('cash-counter-total: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
