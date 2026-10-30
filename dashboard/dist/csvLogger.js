// Shared persistence sink: every live transport emits payload-row, independent of rendering.
const local=['localhost','127.0.0.1'].includes(location.hostname);
const emit=detail=>document.dispatchEvent(new CustomEvent('csv-log-status',{detail}));
let active=null,busy=false,available=false,failed=false;
async function post(url,data){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const out=await r.json();if(!r.ok)throw Error(out.error||'Local CSV write failed');return out;}
async function probe(){if(!local){emit({message:'Project CSV saving requires the local dashboard. Run Start Dashboard.cmd in project_drone.',available:false});return;}try{const r=await fetch('/api/logger/status');if(!r.ok)throw Error();const info=await r.json();available=!!info.available;emit({message:'Automatic CSV logging ready · '+info.directory,available});}catch{emit({message:'Local CSV logger unavailable. Launch Start Dashboard.cmd.',available:false});}}
function create(transport){return {transport,queue:[],start:0,id:null,file:null};}
let transport='serial';
document.addEventListener('payload-session',e=>{if(active?.queue.length)pending.push(active);transport=e.detail?.transport||'serial';active=null;});
document.addEventListener('payload-row',e=>{if(!active)active=create(transport);active.queue.push({row:e.detail,transport:active.transport,at:new Date().toISOString()});flush();});
// Imports and demos are archived as separate, explicitly labeled datasets too.
document.addEventListener('survey-loaded',e=>{if(e.detail.name==='Live payload')return;const target=create(e.detail.name?.startsWith('Synthetic')?'demo':'csv-import');target.queue=e.detail.rows.map(row=>({row,transport:target.transport,at:new Date().toISOString()}));pending.push(target);flush();});
const pending=[];
async function flush(){if(busy||!available)return;const target=pending[0]||(active?.queue.length?active:null);if(!target)return;busy=true;try{
  if(!target.id){const s=await post('/api/logger/session',{});target.id=s.id;target.file=s.file;}
  const batch=target.queue.slice(0,250);if(batch.length){const result=await post('/api/logger/append',{session:target.id,start:target.start,rows:batch});target.queue.splice(0,batch.length);target.start+=batch.length;failed=false;emit({available:true,message:`Saved ${result.saved} rows → ${result.file}`,file:result.file,saved:result.saved});}
  if(!target.queue.length&&pending[0]===target)pending.shift();
}catch(e){failed=true;emit({available:true,error:true,message:'CSV NOT SAVED · '+e.message+' · pending rows retained; retrying.'});}finally{busy=false;}}
document.addEventListener('csv-log-retry',()=>probe().then(flush));
setInterval(()=>{if(active?.queue.length||pending.length)flush();},1000);
window.addEventListener('beforeunload',e=>{if(active?.queue.length||pending.length||busy||failed){e.preventDefault();e.returnValue='CSV rows are waiting to be saved.';}});
queueMicrotask(probe);
