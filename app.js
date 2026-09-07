
const API=(window.APP_CONFIG?.API_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,'');
const MODELS=['MA3','Holt','Seasonal7','Seasonal+Trend','LinearTrend','Regression+Seasonal+Trend','Holt-Winters Additive'];
let STATE={}; let invChart,costChart,eoqChart; let timer;

document.getElementById('models').innerHTML=MODELS.map(m=>`<label><input type="checkbox" value="${m}" checked>${m}</label>`).join('');
document.querySelectorAll('.tab-btn').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab-btn').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.getElementById(b.dataset.tab).classList.add('active')});

function setStatus(s){document.getElementById('status').textContent=s}
async function api(path,opt={}){let r=await fetch(API+path,opt);if(!r.ok)throw new Error(await r.text());return r.json()}
function fmt(v){if(v===null||v===undefined)return '';if(typeof v==='number')return Number.isInteger(v)?v.toString():v.toFixed(3);return v}
function table(el,rows){if(!rows||!rows.length){document.getElementById(el).innerHTML='<em>No data</em>';return}let cols=Object.keys(rows[0]);document.getElementById(el).innerHTML=`<table><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${fmt(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`}
async function refreshState(){STATE=await api('/api/state');renderState()}
function renderState(){
  const inv=STATE.inventory||[],pol=STATE.policy||[],alerts=STATE.alerts||[],cm=STATE.costModel||[];
  document.getElementById('kpiSku').textContent=inv.length;
  document.getElementById('kpiOnHand').textContent=inv.reduce((a,r)=>a+(+r.OnHand||0),0).toFixed(0);
  document.getElementById('kpiAlerts').textContent=alerts.filter(r=>['HIGH','CRITICAL'].includes(r.AlertLevel)).length;
  document.getElementById('kpiValue').textContent=pol.reduce((a,r)=>a+(+r.InventoryValue||0),0).toFixed(0);
  table('alertsTable',alerts);table('policyTable',pol);table('policyTable2',pol);table('costTable',cm);table('serviceTable',STATE.serviceOptimization||[]);table('planTable',STATE.plan||[]);
  let f=STATE.forecast||{};table('forecastSummary',f.summary||[]);table('forecastDetail',f.detail||[]);table('modelComparison',f.modelComparison||[]);table('modelRanking',f.modelRanking||[]);
  ['skuForecast','skuCost'].forEach(id=>{let e=document.getElementById(id),old=e.value;e.innerHTML=(id==='skuForecast'?'<option>ALL</option>':'')+(STATE.skus||[]).map(s=>`<option>${s}</option>`).join('');if([...e.options].some(o=>o.value===old))e.value=old});
  drawInventory(inv); if((STATE.skus||[]).length && !document.getElementById('skuCost').value){document.getElementById('skuCost').value=STATE.skus[0]} loadScenarioDefaults();
}
function drawInventory(inv){let ctx=document.getElementById('invChart');if(invChart)invChart.destroy();invChart=new Chart(ctx,{type:'bar',data:{labels:inv.map(x=>x.SKU),datasets:[{label:'On Hand',data:inv.map(x=>x.OnHand)}]},options:{responsive:true}})}
async function uploadWorkbook(){
 let f=document.getElementById('wb').files[0];
 if(!f)return alert('Select an Excel workbook.');
 setStatus('Uploading workbook...');
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),120000);
 try{
   let fd=new FormData();fd.append('file',f);
   let r=await fetch(API+'/api/workbook/upload',{method:'POST',body:fd,signal:controller.signal});
   if(!r.ok)throw new Error(await r.text());
   await r.json();
   setStatus('Workbook loaded successfully.');
   await refreshState();
 }catch(e){
   if(e.name==='AbortError')setStatus('Upload timed out after 120 seconds. Check backend PowerShell log.');
   else setStatus('Upload failed: '+e.message);
 }finally{clearTimeout(timeout)}
}
async function runForecast(){let models=[...document.querySelectorAll('#models input:checked')].map(x=>x.value);setStatus('Running forecast...');await api('/api/forecast/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku:document.getElementById('skuForecast').value,horizon:+document.getElementById('horizon').value,models})});setStatus('Forecast completed.');await refreshState()}
async function applyPolicy(){setStatus('Applying forecast to inventory policy...');await api('/api/policy/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({use_review_period:document.getElementById('useReview').checked,review_period_days:+document.getElementById('reviewDays').value})});setStatus('Policy, cost model and service optimization updated.');await refreshState()}
async function buildPlan(){setStatus('Building replenishment plan...');await api('/api/replenishment/build',{method:'POST'});setStatus('Replenishment plan completed.');await refreshState()}
function downloadExport(k){window.open(`${API}/api/export/${k}`,'_blank')}
function loadScenarioDefaults(){
 let sku=document.getElementById('skuCost').value;if(!sku)return;let r=(STATE.costModel||[]).find(x=>x.SKU===sku);if(!r)return;
 let D=+r.AnnualDemand||1000,S=(+r.OrderingCostPerOrder||0)+(+r.TransportCostPerOrder||0),H=+r.AnnualHoldingCostPerUnit||1,p=+r.ServiceLevelPct||95;
 let ds=document.getElementById('dSlider');ds.max=Math.max(500,D*2.5);ds.value=D;
 let ss=document.getElementById('sSlider');ss.max=Math.max(100,S*2.5);ss.value=S;
 let hs=document.getElementById('hSlider');hs.max=Math.max(10,H*2.5);hs.value=H;
 document.getElementById('pSlider').value=Math.min(99.9,Math.max(80,p));runScenario();
}
function runScenarioDebounced(){clearTimeout(timer);timer=setTimeout(runScenario,80)}
async function runScenario(){
 let sku=document.getElementById('skuCost').value;if(!sku)return;
 let p=+document.getElementById('pSlider').value,D=+document.getElementById('dSlider').value,S=+document.getElementById('sSlider').value,H=+document.getElementById('hSlider').value;
 document.getElementById('pVal').textContent=p.toFixed(1)+'%';document.getElementById('dVal').textContent=D.toFixed(0);document.getElementById('sVal').textContent=S.toFixed(1);document.getElementById('hVal').textContent=H.toFixed(2);
 let r=await api('/api/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku,annual_demand:D,fixed_cost_per_order:S,holding_cost_per_unit_year:H,service_level_pct:p})});
 drawEOQ(r);drawCost(r.costs);
}
function drawEOQ(r){
 let c=r.curve,ctx=document.getElementById('eoqChart');
 if(eoqChart)eoqChart.destroy();

 const labels=(c.Q||[]).map(v=>Number(v));
 const ordering=(c.Ordering||[]).map(v=>Number(v));
 const holding=(c.Holding||[]).map(v=>Number(v));
 const classical=(c.Classical||[]).map(v=>Number(v));
 const serviceTotal=(c.ServiceTotal||[]).map(v=>Number(v));

 eoqChart=new Chart(ctx,{
   type:'line',
   data:{
     labels:labels,
     datasets:[
       {label:'Ordering Cost',data:ordering,pointRadius:0,borderWidth:2},
       {label:'Holding Cost',data:holding,pointRadius:0,borderWidth:2},
       {label:'Classical Relevant Cost',data:classical,pointRadius:0,borderWidth:2},
       {label:'Total incl. Safety Stock + Shortage',data:serviceTotal,pointRadius:0,borderWidth:2}
     ]
   },
   options:{
     responsive:true,
     animation:false,
     interaction:{mode:'index',intersect:false},
     plugins:{
       title:{display:true,text:`EOQ Cost Curves — p=${Number(r.p).toFixed(1)}% — Q*=${Number(r.EOQ).toFixed(1)}`},
       legend:{display:true}
     },
     scales:{
       x:{
         title:{display:true,text:'Order Quantity Q'},
         ticks:{autoSkip:true,maxTicksLimit:12,maxRotation:0}
       },
       y:{
         beginAtZero:true,
         title:{display:true,text:'Annual Cost'}
       }
     }
   }
 });
}
function drawCost(c){
 let keys=['AnnualOrderingCost','AnnualTransportCost','AnnualHandlingCost','AnnualHoldingCost','AnnualManagementCost','AnnualStorageCost','AnnualShortageCost'];
 let ctx=document.getElementById('costChart');
 if(costChart)costChart.destroy();
 let vals=keys.map(k=>Number(c[k])||0);
 costChart=new Chart(ctx,{
   type:'bar',
   data:{
     labels:keys.map(x=>x.replace('Annual','').replace('Cost','')),
     datasets:[{label:'Annual Cost',data:vals}]
   },
   options:{
     responsive:true,
     animation:false,
     plugins:{title:{display:true,text:'Annual Logistics / Inventory Cost Breakdown'}},
     scales:{y:{beginAtZero:true,title:{display:true,text:'Annual Cost'}}}
   }
 });
}
api('/api/health').then(h=>setStatus(`Backend READY — ${h.version}`)).catch(e=>setStatus('Backend not reachable: '+e.message));
