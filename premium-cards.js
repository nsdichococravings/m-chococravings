/* Premium Cards: no demo data, no background polling, all writes validated by Supabase. */
(function () {
 'use strict';
 let dialog, data, currentOrder=null, priorFocus, busy=false, emailSent=false, accountVerified=false, requestSerial=0;
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'₹'+Number(n||0).toFixed(2);
 const parseItems=x=>Array.isArray(x)?x:JSON.parse(x||'[]');
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function status(message,error){const el=dialog.querySelector('.pc-message');el.textContent=message||'';el.classList.toggle('pc-error',!!error);}
 async function rpc(name,args){if(!window.db)throw Error('Store connection is not ready.');const res=await window.db.rpc(name,args);if(res.error)throw Error(res.error.message.includes('schema cache')?'Premium Cards is not installed yet. Ask admin to run the Premium Cards SQL migration.':res.error.message);return res.data;}
 async function command(action,payload){return rpc('cc_premium_command',{p_action:action,p_payload:payload});}
 function close(){if(busy)return;++requestSerial;dialog.close();dialog.querySelector('.pc-body').innerHTML='';data=null;currentOrder=null;emailSent=false;priorFocus?.focus();}
 function init(){
  if(dialog)return;
  dialog=document.createElement('dialog');dialog.id='pc-dialog';dialog.setAttribute('aria-labelledby','pc-title');
  dialog.innerHTML='<header><div><span>CHOCOCRAVINGS</span><h2 id="pc-title">Premium club</h2></div><button type="button" data-pc="close" aria-label="Close Premium Cards">×</button></header><div class="pc-message" role="status" aria-live="polite"></div><div class="pc-body"></div>';
  document.body.appendChild(dialog);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  dialog.addEventListener('click',event=>{const button=event.target.closest('[data-pc]');if(button)handle(button).catch(e=>status(e.message,true));});
  dialog.addEventListener('submit',event=>{event.preventDefault();submit(event.target).catch(e=>status(e.message,true));});
  const entry=document.createElement('button');entry.type='button';entry.className='pc-menu-entry';entry.textContent='♛ My Premium Card';entry.onclick=()=>open();
  document.querySelector('#pg-menu .pg-hdr')?.appendChild(entry);
  if(window.registerAdminTool)window.registerAdminTool('Daily Operations',{icon:'♛',title:'Premium Cards',subtitle:'Members, rewards & review requests',onClick:()=>open()});
  if(window.location?.search?.includes('premium-card=1'))setTimeout(()=>open(),0);
  if(window.db?.auth.onAuthStateChange)window.db.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){busy=false;close();}});
 }
 async function open(orderId){
  init();if(busy)return;priorFocus=document.activeElement;currentOrder=orderId||null;
  if(!dialog.open)dialog.showModal();dialog.querySelector('.pc-body').innerHTML='';status('Loading Premium Cards…');
  try {const user=await window.db.auth.getUser();if(user.error||!user.data.user)throw Error('Please sign in to view your Premium Card.');accountVerified=!!user.data.user.email_confirmed_at;await refresh();}
  catch(e){status(e.message,true);}
 }
 async function refresh(){const serial=++requestSerial;const result=await rpc('cc_premium_view',{p_order:currentOrder});if(serial!==requestSerial)return;data=result;render();status('');}
 function memberCard(){
  const m=data.member,c=data.cards?.[0];if(!m||!c)return '<section><h3>Your membership starts here</h3><p>Verify your account email, then ask admin to issue your Premium Card. Your mobile number is kept as a contact detail.</p><form data-form="email"><button class="pc-primary">Send email verification link</button></form><p class="pc-muted">Open the link in your email, then return here and refresh. If your account email is already verified, admin can issue the card immediately. No SMS is required.</p></section>';
  const days=Number(c.days),schedule=c.schedule.slice().sort((a,b)=>a.day-b.day),next=schedule.find(x=>x.day>days),available=data.rewards.filter(r=>r.status==='available'),stamps=data.stamps.filter(s=>s.card_id===c.id),goal=next?.day||100,start=Math.max(0,goal-15);
  return '<section class="pc-membership"><div class="pc-card-top"><span>CHOCOCRAVINGS<br><strong>Premium club</strong></span><span>♛</span></div><h3>'+esc(m.name)+'</h3><p>Contact mobile · '+esc(m.phone)+'</p><p>'+ (accountVerified?'Email-verified membership':'Email verification required') +'</p><div class="pc-card-bottom"><span>'+esc(c.number)+'</span><span>Cycle '+c.cycle+' · '+(m.suspended?'Suspended':days>=100?'Completed':'Active')+'</span></div></section>'
   +'<section><div class="pc-between"><h3>Your 100-day journey</h3><strong>'+days+' / 100 days</strong></div><progress max="100" value="'+days+'" aria-label="Qualifying purchase days"></progress><p class="pc-muted">One stamp per purchase day · '+(Number(c.minimum_spend)>0?'Minimum '+money(c.minimum_spend)+' in assigned purchases per day':'Any paid purchase qualifies')+'</p>'
   +'<div class="pc-reward"><span class="pc-eyebrow">'+(next?'YOUR NEXT COMPLIMENT':'CARD COMPLETED')+'</span><h3>'+esc(next?.item||'100 days of good company.')+'</h3><p>'+(next?'Unlocks on purchase day '+next.day+' · '+(next.day-days)+' more to go':'Your next qualifying purchase day begins a new card cycle.')+'</p><div class="pc-stamps">'+Array.from({length:goal-start},(_,i)=>{const day=start+i+1;return '<span class="'+(day<=days?'recorded':'')+'" aria-label="Day '+day+(day<=days?' recorded':' pending')+'">'+(day<=days?'✓':day)+'</span>';}).join('')+'</div></div>'
   +'<p>'+ (stamps.some(s=>s.business_day===today())?'✓ Today’s purchase day is recorded':'Today’s stamp appears after your qualifying order is paid and collected.')+'</p><button class="pc-primary" data-pc="code" '+(m.suspended||!accountVerified?'disabled':'')+'>Verify my visit</button><p class="pc-muted">Dining with friends? Show staff your visit code and ask them to assign your items. One friend can pay the combined bill.</p></section>'
   +'<section><h3>Rewards</h3>'+(data.rewards.length?data.rewards.map(r=>'<div class="pc-row"><div>'+esc(r.item_name)+'<small>Day '+r.milestone+' · '+esc(r.status)+'</small></div>'+(r.status==='available'&&!m.suspended?'<button data-pc="code" data-id="'+r.id+'">Use reward</button>':'')+'</div>').join(''):'<p class="pc-muted">Your rewards unlock at the milestones on your card.</p>')+'</section>'
   +'<form data-form="email"><button>Send account verification email</button></form><details><summary>Purchase-day history</summary>'+stamps.map(s=>'<div class="pc-row">'+esc(s.business_day)+'<span>+1 day</span></div>').join('')+'</details>';
 }
 function adminPanel(){if(data.role!=='admin')return '';const options=(data.menu||[]).map(n=>'<option>'+esc(n)+'</option>').join('');return '<details><summary>Admin · Issue a Premium Card</summary><form data-form="issue"><label>Customer name<input name="name" required maxlength="120"></label><label>Customer account email<input type="email" name="email" required></label><label>Contact mobile (not SMS-verified)<input type="tel" name="phone" placeholder="+919876543210" required autocomplete="tel"></label><div class="pc-fields"><label>Reward every<select name="interval"><option value="10">10 purchase days</option><option value="15">15 purchase days</option></select></label><label>Minimum spend per day (₹)<input type="number" min="0" max="999999" step="0.01" name="minimum_spend" value="0" required></label></div><label>Default complimentary item<select name="item" required>'+options+'</select></label><button type="button" data-pc="schedule">Build editable milestones</button><div class="pc-schedule"></div><p class="pc-muted">Review each reward below. Day 100 is always included. The schedule carries into the next card cycle.</p><button class="pc-primary">Issue card</button></form></details>'
  +'<details><summary>Admin · Members ('+data.members.length+', latest 200)</summary>'+data.members.map(m=>'<div class="pc-row"><div>'+esc(m.name)+'<small>'+esc(m.phone)+' · '+(m.suspended?'Suspended':'Active')+'</small></div><button data-pc="suspend" data-id="'+m.id+'" data-suspended="'+!m.suspended+'">'+(m.suspended?'Reactivate':'Suspend')+'</button></div>').join('')+'</details>'
  +'<details><summary>Admin · Pending reviews ('+data.reviews.length+')</summary>'+data.reviews.map(r=>'<section><p>'+esc(r.reason)+'</p><small>Member '+esc(r.member_id)+' · '+esc(r.created_at)+'</small><form data-form="review" data-id="'+r.id+'"><label>Resolution note<textarea name="note" required></textarea></label><label>Decision<select name="approve"><option value="true">Approve resolution</option><option value="false">Reject request</option></select></label><label>Purchase correction<select name="resolution"><option value="honor_reward">Honor affected reward</option><option value="forfeit_reward">Forfeit affected reward</option><option value="reconcile">Recheck recorded evidence</option><option value="exclude_purchase">Exclude this purchase</option><option value="restore_purchase">Restore paid purchase evidence</option></select></label><button>Save review</button></form></section>').join('')+'<p class="pc-muted">Review records do not create stamps without qualifying purchase evidence.</p></details>';}
 function orderPanel(){const o=data.order;if(!o)return '<p>Order not found.</p>';const items=parseItems(o.items),open=!['collected','cancelled'].includes(o.status),alloc=data.allocations||[];
  return '<h3>Premium customers for this order</h3><p>Assign each person their own pieces. They can share one payment.</p><form data-form="assign"><label>Customer visit code<input name="code" required placeholder="Paste customer’s one-time visit code" autocomplete="off"></label>'+items.map((i,index)=>{const assigned=alloc.filter(a=>a.item_index===index).reduce((s,a)=>s+a.quantity,0),left=i.complimentary?0:Number(i.qty)-assigned;return '<label class="pc-allocation"><span>'+esc(i.name)+'<small>'+left+' unassigned · '+money(i.price)+' each</small></span><input aria-label="Assign '+esc(i.name)+' quantity" data-index="'+index+'" type="number" min="0" max="'+Math.max(0,left)+'" value="0" step="1" '+(!open||left<=0||Number(i.price)<=0?'disabled':'')+'></label>';}).join('')+'<button class="pc-primary" '+(!open?'disabled':'')+'>Verify & assign selected pieces</button></form>'
  +'<section><h3>Current assignments</h3>'+alloc.map(a=>'<div class="pc-row"><div>'+esc(a.customer_name)+' · '+esc(a.phone)+'<small>'+esc(a.name)+' ×'+a.quantity+'</small></div>'+(open?'<button data-pc="unlink" data-id="'+a.member_id+'">Unlink customer</button>':'')+'</div>').join('')+'</section>'
  +(open?'<details><summary>Add a complimentary reward</summary><form data-form="reserve"><label>Customer reward code<input name="code" required autocomplete="off"></label><p class="pc-muted">Adds the permitted item as complimentary. Collection redeems it; cancellation releases it.</p><button>Verify & add reward</button></form></details>':'')
  +'<details><summary>Request admin correction</summary><form data-form="request_review"><label>Premium customer<select name="member_id" required>'+[...new Map(alloc.map(a=>[a.member_id,a])).values()].map(a=>'<option value="'+a.member_id+'">'+esc(a.customer_name)+'</option>').join('')+'</select></label><label>What needs correcting?<textarea name="reason" required></textarea></label><button>Send review request</button></form></details>';
 }
 function render(){dialog.querySelector('.pc-body').innerHTML=currentOrder?orderPanel():memberCard()+adminPanel()+'<button data-pc="refresh">Refresh card</button>';}
 async function handle(button){if(button.dataset.pc==='close'){close();return;}if(busy)return;
  const action=button.dataset.pc;
  if(action==='refresh'){await refresh();return;}
  if(action==='schedule'){const f=button.closest('form'),interval=Number(f.elements.interval.value),item=f.elements.item.value,days=[];for(let d=interval;d<100;d+=interval)days.push(d);days.push(100);f.querySelector('.pc-schedule').innerHTML=days.map(d=>'<label class="pc-allocation">Day '+d+'<select data-day="'+d+'">'+data.menu.map(n=>'<option '+(n===item?'selected':'')+'>'+esc(n)+'</option>').join('')+'</select></label>').join('');return;}
  busy=true;button.disabled=true;
  try{
   if(action==='code'){const res=await command('code',button.dataset.id?{reward_id:button.dataset.id}:{});const body=dialog.querySelector('.pc-body');let panel=body.querySelector('.pc-code');if(!panel){panel=document.createElement('section');panel.className='pc-code';body.prepend(panel);}panel.innerHTML='<h3>'+(button.dataset.id?'Reward verification':'Visit verification')+'</h3><p>Show this one-time code to staff. It expires at '+esc(new Date(res.expires_at).toLocaleTimeString())+'.</p><input readonly aria-label="One-time verification code" value="'+esc(res.code)+'"><button data-pc="hide-code">Close code</button>';panel.querySelector('input').select();}
   if(action==='hide-code')button.closest('.pc-code').remove();
   if(action==='suspend'){const reason=prompt('Reason for this membership change:');if(!reason)return;await command('suspend',{member_id:button.dataset.id,suspended:button.dataset.suspended==='true',reason});await refresh();}
   if(action==='unlink'){if(!confirm('Remove this customer’s assignments from the open order?'))return;await command('unlink',{order_id:currentOrder,member_id:button.dataset.id});await refresh();}
  }finally{busy=false;button.disabled=false;}
 }
 async function submit(form){if(busy)return;busy=true;const button=form.querySelector('button[type=submit],button:not([type])');if(button)button.disabled=true;status('Saving…');
  try{const fields=Object.fromEntries(new FormData(form)),kind=form.dataset.form;
   if(kind==='email'){
    if(emailSent)throw Error('A verification link has already been requested. Check your inbox and spam folder.');
    const current=await window.db.auth.getUser();if(current.error||!current.data.user?.email)throw Error('Sign in using your email account first.');
    const redirect=window.location.origin+'/store?premium-card=1';
    const res=await window.db.auth.signInWithOtp({email:current.data.user.email,options:{shouldCreateUser:false,emailRedirectTo:redirect}});
    if(res.error)throw Error('Email could not be sent: '+res.error.message+' Admin may need to configure Supabase SMTP.');
    emailSent=true;status('Verification link requested for '+current.data.user.email+'. Check your inbox and spam folder, open the link, then refresh your card.');return;
   }
   let payload={...fields};
   if(kind==='issue'){payload.schedule=[...form.querySelectorAll('[data-day]')].map(s=>({day:Number(s.dataset.day),item:s.value}));if(!payload.schedule.length)throw Error('Build and review your reward milestones first.');}
   if(kind==='assign'){payload.order_id=currentOrder;payload.items=[...form.querySelectorAll('[data-index]')].filter(i=>!i.disabled&&Number(i.value)>0).map(i=>({index:Number(i.dataset.index),quantity:Number(i.value)}));if(!payload.items.length)throw Error('Select at least one piece.');}
   if(kind==='reserve'||kind==='request_review')payload.order_id=currentOrder;
   if(kind==='review'){payload.id=form.dataset.id;payload.approve=fields.approve==='true';}
   const result=await command(kind,payload);await refresh();status(result.customer?'Verified: '+result.customer+'. Saved.':'Saved successfully.');if(currentOrder&&window.kitchenManualRefresh)window.kitchenManualRefresh();
  }catch(e){status(e.message,true);}finally{busy=false;if(button)button.disabled=false;}
 }
 window.openPremiumCards=open;window.openPremiumOrder=id=>open(id);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
