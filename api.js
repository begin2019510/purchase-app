async function api(method,body,id){
  let url=API;
  const opts={method,headers:{'Content-Type':'application/json','X-API-Key':getPin()}};
  if(method==='DELETE')url+='?id='+id;
  else if(body)opts.body=JSON.stringify(body);
  const r=await fetch(url,opts);
  if(r.status===401){document.getElementById('pinScreen').style.display='flex';document.getElementById('pinError').textContent='会话过期';return{error:'unauthorized'}}
  return r.json();
}
async function expenseApi(method,body,id){
  let url=EXPENSE_API;
  const opts={method,headers:{'Content-Type':'application/json','X-API-Key':getPin()}};
  if(method==='DELETE')url+='?id='+id;
  else if(body)opts.body=JSON.stringify(body);
  const r=await fetch(url,opts);
  if(r.status===401)return{error:'unauthorized'};
  return r.json();
}
