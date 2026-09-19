/* Table item payment UI. All amounts and unpaid quantities are rechecked by SQL. */
function tipEscape(value) {
  return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
}
function tableItemPaymentControl(order,item,index) {
  if(!order.table_code || typeof order.paid_amount==='undefined' || item.complimentary || Number(item.price)<=0) return '';
  var paid=Number((order.paid_item_quantities||{})[index]||0),qty=Number(item.qty);
  if(order.payment_status==='paid') paid=qty;
  var label=paid?'<span style="color:#4ade80;background:rgba(74,222,128,.15);padding:5px;border-radius:6px">Paid '+paid+'/'+qty+'</span>':'';
  if(paid<qty && order.payment_status!=='complimentary') label+='<button type="button" onclick="openTableItemPayment(\''+order.id+'\','+index+')" style="padding:7px;border-radius:8px;background:#19683b;color:white;border:0">Collect</button>';
  return '<span style="display:flex;gap:5px;align-items:center">'+label+'</span>';
}
function tablePaymentSummary(order) {
  var paid=Number(order.paid_amount||0);
  if(!order.table_code || paid<=0) return '';
  return '<div style="color:#4ade80;margin:8px 0;font-weight:700">Bill ₹'+Number(order.total).toFixed(2)+' · Paid ₹'+paid.toFixed(2)+' · Balance due ₹'+Math.max(0,Number(order.total)-paid).toFixed(2)+'</div>';
}
async function openTableItemPayment(orderId,index) {
  if(document.getElementById('tip-dialog')) return;
  var dialog=document.createElement('dialog');dialog.id='tip-dialog';
  dialog.style.cssText='border:0;border-radius:18px;padding:24px;width:min(420px,90vw);box-sizing:border-box;color:#20152a;background:#fff;z-index:5000';
  dialog.textContent='Loading unpaid quantity…';document.body.appendChild(dialog);dialog.showModal();
  var pending=false,key=crypto.randomUUID();
  dialog.addEventListener('cancel',function(e){if(pending)e.preventDefault();});
  dialog.addEventListener('close',function(){dialog.remove();});
  try {
    var res=await db.from('store_orders').select('*').eq('id',orderId).single();if(res.error)throw res.error;
    var order=res.data,items=Array.isArray(order.items)?order.items:JSON.parse(order.items||'[]'),item=items[index];
    if(!item || !order.table_code || ['collected','cancelled'].includes(order.status))throw Error('Order changed. Refresh Kitchen.');
    var paid=Number((order.paid_item_quantities||{})[index]||0),remaining=Number(item.qty)-paid;
    if(remaining<=0)throw Error('This item is already paid.');
    dialog.innerHTML='<form><h3 style="margin-top:0">Collect: '+tipEscape(item.name)+'</h3><p>'+paid+' of '+Number(item.qty)+' paid · '+remaining+' unpaid</p>'+ 
      '<label>How many pieces are being paid for?<input name="quantity" type="number" min="1" max="'+remaining+'" step="1" value="1" required style="display:block;padding:10px;width:100%;box-sizing:border-box"></label>'+
      '<p data-amount style="font-size:20px;font-weight:bold"></p><label>Payment received by<select name="method" required style="display:block;padding:10px;width:100%"><option value="cash">Cash</option><option value="upi">UPI</option><option value="upi_qr">Scan QR</option><option value="card">Card</option></select></label>'+
      '<p>Confirm only after receiving payment. This records payment; it does not charge a card or UPI account.</p><p role="alert" style="color:#b91c1c"></p><button type="button" data-cancel>Cancel</button> <button type="submit">Confirm collected</button></form>';
    var form=dialog.querySelector('form'),qtyInput=form.querySelector('[name=quantity]');
    function amount(){return Math.round(Number(qtyInput.value)*Number(item.price)*100)/100;}
    function update(){form.querySelector('[data-amount]').textContent='Collect ₹'+amount().toFixed(2);}
    qtyInput.addEventListener('input',update);update();
    form.querySelector('[data-cancel]').onclick=function(){if(!pending)dialog.close();};
    form.addEventListener('submit',async function(e){
      e.preventDefault();if(pending)return;
      var quantity=Number(qtyInput.value);if(!Number.isInteger(quantity)||quantity<1||quantity>remaining)return;
      pending=true;form.querySelectorAll('button,input,select').forEach(function(el){el.disabled=true;});
      try {
        var split={};split[form.querySelector('[name=method]').value]=amount();
        var response=await db.rpc('cc_collect_table_payment',{p_key:key,p_payload:{order_id:orderId,item_index:index,quantity:quantity,expected_name:item.name,expected_price:Number(item.price),expected_total:Number(order.total),split:split}});
        if(response.error)throw response.error;
        pending=false;dialog.close();
        showStoreToast(response.data.closed?'Bill fully paid — table order closed':'Payment recorded · balance ₹'+Number(response.data.balance).toFixed(2));
        await kitchenManualRefresh();
        if(typeof loadTablesStatus==='function' && document.getElementById('ts-board-sheet')?.style.display==='block')loadTablesStatus();
      } catch(error){form.querySelector('[role=alert]').textContent=error.message||'Payment not confirmed. Retry without changing the details.';}
      finally{pending=false;form.querySelectorAll('button,input,select').forEach(function(el){el.disabled=false;});}
    });
  } catch(error){dialog.textContent=error.message;var close=document.createElement('button');close.textContent='Close';close.onclick=function(){dialog.close();};dialog.appendChild(close);}
}
