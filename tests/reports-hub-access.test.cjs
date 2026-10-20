const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('../.production-test-runtime/node_modules/linkedom');
function setup(superUser){
  const {document}=parseHTML('<html><body></body></html>');
  const opened=[],toasts=[];
  const ctx={document,console,isAdmin:true,setInterval(){},clearInterval(){},
    showStoreToast:m=>toasts.push(m),registerAdminTool(){},
    openDayClose:()=>opened.push('daily-close'),openExpenses:()=>opened.push('expenses'),openReports:()=>opened.push('sales-reports')};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('reports-hub-patch.js','utf8'),ctx);
  ctx._rhIsSuperUser=superUser;
  return {ctx,document,opened,toasts};
}
(async()=>{
  // Regular admin: no Daily Close card, and it cannot be opened directly.
  let t=setup(false);await t.ctx.openReportsHub();
  let cards=t.document.getElementById('rh-cards').textContent;
  assert.doesNotMatch(cards,/Daily Close/,'regular admin does not see Daily Close');
  assert.match(cards,/Daily Expenses/,'regular admin still sees Daily Expenses');
  t.ctx.rhOpen('daily-close');t.ctx.rhOpen('sales-reports');
  assert.deepEqual(t.opened,[],'owner reports refuse to open');assert.equal(t.toasts.length,2);
  t.ctx.rhOpen('expenses');assert.deepEqual(t.opened,['expenses']);
  // Owner: sees and opens Daily Close.
  t=setup(true);await t.ctx.openReportsHub();
  cards=t.document.getElementById('rh-cards').textContent;
  assert.match(cards,/Daily Close/);assert.match(cards,/Sales Reports/);
  t.ctx.rhOpen('daily-close');assert.deepEqual(t.opened,['daily-close']);
  console.log('PASS: Daily Close owner-only (hidden and blocked for regular admins), expenses still for admins, owner sees and opens it.');
})().catch(e=>{console.error(e);process.exitCode=1;});
