const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function load(file,store,now){
  const calls=[],badges=[];
  const ctx={console:{warn(){}},Date:{now:()=>now},JSON,Math,Object,Array,String,Number,
    localStorage:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=v;}},
    document:{readyState:'complete',addEventListener(){},createElement:()=>({style:{},appendChild(){},addEventListener(){}}),body:{appendChild(){}},getElementById:()=>null},
    window:{},showStoreToast(){},ccUpdateBadge:(id,n)=>badges.push([id,n]),registerAdminTool(){},
    db:{rpc:async(name)=>{calls.push(name);return {data:name==='cc_birthday_report'?{today:[{name:'A'}],upcoming:[]}:{low_7d:2}};}}};
  ctx.window=ctx;ctx.window.registerAdminTool=()=>{};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
  return {calls,badges};
}
(async()=>{
  for(const [file,rpc,count] of [['birthday-report-patch.js','cc_birthday_report',1],['ratings-report-patch.js','cc_ratings_report',2]]){
    const store={};let t=0;
    let r=load(file,store,t);await new Promise(x=>setImmediate(x));
    assert.deepEqual(r.calls,[rpc],file+': first open loads the report');
    r=load(file,store,t+10*60*1000);await new Promise(x=>setImmediate(x));
    assert.deepEqual(r.calls,[],file+': reopened 10 min later -> no database call');
    assert.equal(r.badges[0][1],count,file+': saved badge count shown');
    r=load(file,store,t+31*60*1000);await new Promise(x=>setImmediate(x));
    assert.deepEqual(r.calls,[rpc],file+': after 30 min it refreshes');
  }
  console.log('PASS: birthday and ratings badges refresh at most every 30 min; saved count shown in between.');
})().catch(e=>{console.error(e);process.exitCode=1;});
