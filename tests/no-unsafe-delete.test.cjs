// Supabase's safeupdate extension rejects DELETE without WHERE for requests from the app
// ("DELETE requires a WHERE clause"), including inside functions those requests call.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const dir=path.join(__dirname,'..','migrations');
const bad=[];
for (const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql'))) {
  fs.readFileSync(path.join(dir,f),'utf8').split('\n').forEach((line,i)=>{
    const code=line.replace(/--.*$/,'');
    if (/\bdelete\s+from\s+[\w.]+\s*;/i.test(code)) bad.push(f+':'+(i+1)+': '+line.trim());
  });
}
assert.deepEqual(bad,[],'DELETE without WHERE (use "where true"):\n'+bad.join('\n'));
console.log('PASS no DELETE without WHERE in migrations.');
