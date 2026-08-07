const STORAGE_KEY = "furniture-income-app-v1";
const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const WEEKDAYS = ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"];

let state = migrateState(loadState());
let deferredInstallPrompt = null;

function clone(value){ return JSON.parse(JSON.stringify(value)); }
function loadState(){
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch(e) {}
  return clone(window.APP_SEED);
}
function migrateState(data){
  const next=data&&typeof data==="object"?data:clone(window.APP_SEED);
  next.orders=Array.isArray(next.orders)?next.orders:[];
  next.settings=next.settings||{};
  next.dailyHours=next.dailyHours||{};
  next.weekendHours=next.weekendHours||{};
  next.workDays=next.workDays||{};
  for(const [date,h] of Object.entries(next.dailyHours)){
    if(next.workDays[date]||!Number(h)) continue;
    const mins=Math.round(Number(h)*60);
    const start=9*60;
    next.workDays[date]={start:'09:00',end:`${String(Math.floor((start+mins)/60)%24).padStart(2,'0')}:${String((start+mins)%60).padStart(2,'0')}`,pauses:[],legacy:true};
  }
  next.orders=next.orders.map(o=>({
    ...o,
    status:o.status||(!o.endDate?"in_progress":"completed")
  }));
  return next;
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
}
function toast(message){
  const el=document.getElementById("toast");
  el.textContent=message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove("show"),2200);
}
function money(value){ return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0}).format(Number(value)||0)+" ₽"; }
function number(value,digits=1){ return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:digits}).format(Number(value)||0); }
function parseTime(value){
  if(!value) return 0;
  const [h,m]=value.split(":").map(Number);
  return h+m/60;
}
function toISODate(d){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function parseDate(s){ return new Date(`${s}T12:00:00`); }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function todayISO(){ return toISODate(new Date()); }
function mondayISO(date){
  const d=new Date(date),day=(d.getDay()+6)%7;
  return toISODate(addDays(d,-day));
}
function standardHours(){ return 0; }
function legacyWeekendHours(date){
  const cfg=state.weekendHours[mondayISO(date)]||{sat:0,sun:0};
  return date.getDay()===6?Number(cfg.sat)||0:Number(cfg.sun)||0;
}
function scheduledHours(date){
  const key=toISODate(date);
  if(Object.prototype.hasOwnProperty.call(state.dailyHours,key)) return Math.max(0,Number(state.dailyHours[key])||0);
  const dow=date.getDay();
  if(dow===0||dow===6) return legacyWeekendHours(date);
  return 0;
}
function isCompleted(order){ return (order.status||"completed")==="completed"; }
function workDayFor(date){
  const key=typeof date==='string'?date:toISODate(date);
  state.workDays=state.workDays||{};
  return state.workDays[key]||null;
}
function workIntervals(day){
  if(!day||!day.start) return [];
  const end=day.end||null;
  const pauses=Array.isArray(day.pauses)?day.pauses:[];
  const finish=end||new Date().toTimeString().slice(0,5);
  const start=parseTime(day.start), stop=parseTime(finish);
  if(stop<=start) return [];
  const points=[[start,stop]];
  for(const p of pauses){
    if(!p.start) continue;
    const ps=parseTime(p.start), pe=parseTime(p.end||finish);
    if(pe<=ps) continue;
    const next=[];
    for(const [a,b] of points){
      if(pe<=a||ps>=b){ next.push([a,b]); continue; }
      if(ps>a) next.push([a,ps]);
      if(pe<b) next.push([pe,b]);
    }
    points.splice(0,points.length,...next);
  }
  return points.filter(([a,b])=>b>a);
}
function minutesForRange(day,dateStart,dateEnd){
  const intervals=workIntervals(day);
  let total=0;
  for(const [a,b] of intervals){ total+=Math.max(0,Math.min(b,dateEnd)-Math.max(a,dateStart)); }
  return total;
}
function dailyBreakdown(order,{pastOnly=false}={}){
  if(!order.startDate) return [];
  const start=parseDate(order.startDate),end=parseDate(order.endDate||order.startDate);
  if(end<start) return [];
  const out=[],today=todayISO();
  for(let d=new Date(start);d<=end;d=addDays(d,1)){
    const iso=toISODate(d);
    if(pastOnly&&iso>today) continue;
    const day=workDayFor(iso);
    if(!day||!day.start) { out.push({date:iso,hours:0}); continue; }
    const same=iso===order.startDate&&iso===order.endDate;
    const first=iso===order.startDate,last=iso===order.endDate;
    let from=first?parseTime(order.startTime||day.start):parseTime(day.start);
    let to=last?(order.endTime?parseTime(order.endTime):(iso===todayISO()?parseTime(new Date().toTimeString().slice(0,5)):parseTime(day.end||day.start))):parseTime(day.end||day.start);
    if(to<=from) { out.push({date:iso,hours:0}); continue; }
    const mins=minutesForRange(day,from,to);
    out.push({date:iso,hours:mins/60});
  }
  return out;
}
function orderHours(order,options){ return dailyBreakdown(order,options).reduce((s,x)=>s+x.hours,0); }
function analytics(year){
  const months=Array.from({length:12},(_,i)=>({month:i,hours:0,income:0,dates:new Set()}));
  for(const order of state.orders.filter(isCompleted)){
    const days=dailyBreakdown(order,{pastOnly:true}).filter(x=>x.hours>0);
    const total=days.reduce((s,x)=>s+x.hours,0);
    if(total<=0) continue;
    const byMonth={};
    for(const day of days){
      const d=parseDate(day.date);
      if(d.getFullYear()!==year) continue;
      const m=d.getMonth();
      byMonth[m]=(byMonth[m]||0)+day.hours;
      months[m].dates.add(day.date);
    }
    for(const [m,h] of Object.entries(byMonth)){
      months[Number(m)].hours+=h;
      months[Number(m)].income+=(Number(order.income)||0)*h/total;
    }
  }
  return months.map(m=>({...m,days:m.dates.size}));
}
function availableYears(){
  const years=new Set([new Date().getFullYear()]);
  state.orders.forEach(o=>{
    if(o.startDate) years.add(parseDate(o.startDate).getFullYear());
    if(o.endDate) years.add(parseDate(o.endDate).getFullYear());
  });
  Object.keys(state.dailyHours).forEach(k=>years.add(parseDate(k).getFullYear()));
  return [...years].sort((a,b)=>b-a);
}
function fillYearSelects(){
  const years=availableYears();
  for(const id of ["yearSelect","calendarYearSelect"]){
    const el=document.getElementById(id),current=Number(el.value)||new Date().getFullYear();
    el.innerHTML=years.map(y=>`<option value="${y}">${y}</option>`).join("");
    el.value=years.includes(current)?current:years[0];
  }
}
function renderDashboard(){
  const year=Number(document.getElementById("yearSelect").value)||new Date().getFullYear();
  const data=analytics(year);
  const total=data.reduce((a,m)=>({hours:a.hours+m.hours,income:a.income+m.income,days:a.days+m.days}),{hours:0,income:0,days:0});
  const completedCount=state.orders.filter(o=>isCompleted(o)&&o.endDate&&parseDate(o.endDate).getFullYear()===year).length;
  document.getElementById("yearIncome").textContent=money(total.income);
  document.getElementById("yearHours").textContent=number(total.hours,1);
  document.getElementById("avgHour").textContent=money(total.hours?total.income/total.hours:0);
  document.getElementById("avgDay").textContent=money(total.days?total.income/total.days:0);
  document.getElementById("elapsedDays").textContent=total.days;
  document.getElementById("yearMeta").textContent=`${completedCount} завершённых заказов · ${number(total.hours,1)} часов`;
  const maxIncome=Math.max(1,...data.map(m=>m.income));
  document.getElementById("monthsList").innerHTML=data.map(m=>`
    <div class="month-row">
      <div class="month-name">${MONTHS[m.month]}</div>
      <div><div><strong>${money(m.income)}</strong></div><div class="month-bar"><i style="width:${Math.max(0,m.income/maxIncome*100)}%"></i></div></div>
      <div class="month-stats"><strong>${number(m.hours,1)} ч</strong><span>${money(m.days?m.income/m.days:0)} / день · ${m.days} дн.</span></div>
    </div>`).join("");
}
function filteredOrders(status){
  const q=(document.getElementById(status==="completed"?"orderSearch":"progressSearch")?.value||"").trim().toLowerCase();
  return [...state.orders].filter(o=>(isCompleted(o)?"completed":"in_progress")===status)
    .sort((a,b)=>(b.startDate||"").localeCompare(a.startDate||""))
    .filter(o=>`${o.number} ${o.work} ${o.comment}`.toLowerCase().includes(q));
}
function orderCard(o,inProgress=false){
  const h=orderHours(o,{pastOnly:true}),per=!inProgress&&h?(Number(o.income)||0)/h:0;
  const status=inProgress?'<span class="status-badge">В процессе</span>':"";
  const completion=o.endDate?`${formatDate(o.endDate)}${o.endTime?` в ${o.endTime}`:""}`:"Не указано";
  return `<article class="order-card ${inProgress?"in-progress-card":""}" data-id="${o.id}">
    <div><div class="order-title">Заказ ${escapeHtml(o.number)} ${status}</div>
    <div class="order-work">${escapeHtml(o.work||"Без описания")}</div>
    <div class="order-meta"><span>${formatDate(o.startDate)} → ${completion}</span><span>${number(h,1)} ч на сегодня</span>${inProgress?"":`<span>${money(per)}/ч</span>`}</div></div>
    <div class="order-money">${inProgress?"Не учтён":money(o.income)}<small>${escapeHtml(o.comment||"")}</small></div>
  </article>`;
}
function renderOrders(){
  const rows=filteredOrders("completed"),list=document.getElementById("ordersList");
  list.innerHTML=rows.map(o=>orderCard(o,false)).join("");
  document.getElementById("ordersEmpty").classList.toggle("hidden",rows.length>0);
  list.querySelectorAll(".order-card").forEach(el=>el.onclick=()=>openOrder(el.dataset.id));
}
function renderProgress(){
  const rows=filteredOrders("in_progress"),list=document.getElementById("progressList");
  list.innerHTML=rows.map(o=>orderCard(o,true)).join("");
  document.getElementById("progressEmpty").classList.toggle("hidden",rows.length>0);
  document.getElementById("progressCount").textContent=rows.length;
  list.querySelectorAll(".order-card").forEach(el=>el.onclick=()=>openOrder(el.dataset.id));
}
function renderCalendar(){
  const year=Number(document.getElementById("calendarYearSelect").value)||new Date().getFullYear();
  const months=[];
  for(let m=0;m<12;m++){
    const days=[];
    for(let d=new Date(year,m,1,12);d.getMonth()===m;d=addDays(d,1)){
      const key=toISODate(d),value=scheduledHours(d),future=key>todayISO();
      days.push(`<label class="day-hour ${future?"future-day":""}"><span>${WEEKDAYS[d.getDay()]}, ${String(d.getDate()).padStart(2,"0")}.${String(m+1).padStart(2,"0")}</span><input class="daily-hour" data-date="${key}" type="number" min="0" max="24" step="0.5" value="${Math.round(value*10)/10}"></label>`);
    }
    months.push(`<details class="month-hours" ${m===new Date().getMonth()&&year===new Date().getFullYear()?"open":""}><summary>${MONTHS[m]}</summary><div class="day-hours-grid">${days.join("")}</div></details>`);
  }
  const list=document.getElementById("weeksList");
  list.innerHTML=months.join("");
  list.querySelectorAll(".daily-hour").forEach(el=>el.onchange=()=>{
    state.dailyHours[el.dataset.date]=Math.max(0,Math.min(24,Number(el.value)||0));
    saveState(); toast("Часы дня сохранены");
  });
}
function renderSettings(){}
function renderAll(){ fillYearSelects(); renderDashboard(); renderOrders(); renderProgress(); renderCalendar(); renderSettings(); renderCurrentShift(); }
function escapeHtml(value){ return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
function formatDate(s){
  if(!s) return "—";
  return new Intl.DateTimeFormat("ru-RU",{day:"2-digit",month:"2-digit",year:"2-digit"}).format(parseDate(s));
}
function syncStatusFields(){
  const inProgress=document.getElementById("orderStatus").checked;
  document.getElementById("completionLabel").textContent=inProgress?"Плановая дата выполнения":"Дата окончания";
  document.getElementById("completionTimeLabel").textContent=inProgress?"Плановое время":"Время окончания";
  document.getElementById("income").required=!inProgress;
  document.getElementById("incomeHelp").classList.toggle("hidden",!inProgress);
  updateOrderPreview();
}
function openOrder(id=null){
  document.getElementById("orderForm").reset();
  const order=id?state.orders.find(o=>o.id===id):null;
  document.getElementById("orderDialogTitle").textContent=order?"Редактировать заказ":"Новый заказ";
  document.getElementById("deleteOrderBtn").classList.toggle("hidden",!order);
  document.getElementById("orderId").value=order?.id||"";
  document.getElementById("orderStatus").checked=(order?.status||"completed")==="in_progress";
  document.getElementById("orderNumber").value=order?.number||"";
  document.getElementById("startDate").value=order?.startDate||todayISO();
  document.getElementById("endDate").value=order?.endDate||todayISO();
  document.getElementById("startTime").value=order?.startTime||"09:00";
  document.getElementById("endTime").value=order?.endTime||"18:00";
  document.getElementById("workDone").value=order?.work||"";
  document.getElementById("income").value=order?.income??"";
  document.getElementById("comment").value=order?.comment||"";
  syncStatusFields();
  document.getElementById("orderDialog").showModal();
}
function formOrder(){
  return {
    id:document.getElementById("orderId").value||crypto.randomUUID(),
    status:document.getElementById("orderStatus").checked?"in_progress":"completed",
    number:document.getElementById("orderNumber").value.trim(),
    startDate:document.getElementById("startDate").value,
    startTime:document.getElementById("startTime").value,
    endDate:document.getElementById("endDate").value,
    endTime:document.getElementById("endTime").value,
    work:document.getElementById("workDone").value.trim(),
    income:Number(document.getElementById("income").value)||0,
    comment:document.getElementById("comment").value.trim(),
    createdAt:new Date().toISOString()
  };
}
function updateOrderPreview(){
  const o=formOrder(),h=orderHours(o,{pastOnly:o.status==="in_progress"}),per=h?o.income/h:0;
  document.getElementById("orderPreview").textContent=o.status==="in_progress"
    ?`В процессе: ${number(h,1)} ч на сегодня. В итогах не учитывается.`
    :`Расчёт: ${number(h,1)} ч · ${money(per)} в час`;
}
document.querySelectorAll(".nav-btn").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".nav-btn").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active"); document.getElementById(btn.dataset.view).classList.add("active");
  scrollTo({top:0,behavior:"smooth"});
});
document.getElementById("addOrderBtn").onclick=()=>openOrder();
document.getElementById("addProgressBtn").onclick=()=>{openOrder();document.getElementById("orderStatus").checked=true;syncStatusFields();};
document.getElementById("closeOrderDialog").onclick=()=>document.getElementById("orderDialog").close();
document.getElementById("orderForm").onsubmit=e=>{
  e.preventDefault();
  const o=formOrder();
  if(parseDate(o.endDate)<parseDate(o.startDate)){toast("Дата выполнения раньше даты начала");return;}
  const idx=state.orders.findIndex(x=>x.id===o.id);
  if(idx>=0) state.orders[idx]={...state.orders[idx],...o}; else state.orders.push(o);
  saveState();document.getElementById("orderDialog").close();toast("Заказ сохранён");
};
document.getElementById("deleteOrderBtn").onclick=()=>{
  const id=document.getElementById("orderId").value;
  if(!id||!confirm("Удалить заказ?"))return;
  state.orders=state.orders.filter(o=>o.id!==id);saveState();document.getElementById("orderDialog").close();toast("Заказ удалён");
};
["startDate","endDate","startTime","endTime","income"].forEach(id=>document.getElementById(id).addEventListener("input",()=>{if(id.includes('Time'))document.getElementById(id).value=normalizeTime(document.getElementById(id).value);updateOrderPreview();}));
document.querySelectorAll('.time-now').forEach(btn=>btn.onclick=()=>{document.getElementById(btn.dataset.timeTarget).value=currentTime24();updateOrderPreview();});
document.getElementById("orderStatus").addEventListener("change",syncStatusFields);
document.getElementById("orderSearch").oninput=renderOrders;
document.getElementById("progressSearch").oninput=renderProgress;
document.getElementById("yearSelect").onchange=renderDashboard;
document.getElementById("calendarYearSelect").onchange=renderCalendar;

function formatTime24(value){
  if(!value) return "—";
  const m=String(value).match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return "—";
  return `${String(Math.min(23,Number(m[1]))).padStart(2,'0')}:${m[2]}`;
}
function currentTime24(){ return new Date().toTimeString().slice(0,5); }
function minutesToLabel(mins){
  mins=Math.max(0,Math.round(mins));
  return `${Math.floor(mins/60)} ч ${String(mins%60).padStart(2,'0')} мин`;
}
function currentShiftKey(){ return todayISO(); }
function renderCurrentShift(){
  state.workDays=state.workDays||{};
  const key=currentShiftKey(),day=state.workDays[key]||{pauses:[]};
  document.getElementById('currentWorkDate').textContent=new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date());
  document.getElementById('currentWorkDateMeta').textContent=key;
  document.getElementById('shiftStartValue').textContent=formatTime24(day.start);
  document.getElementById('shiftEndValue').textContent=formatTime24(day.end);
  const active=day.pauses?.find(p=>p.start&&!p.end);
  document.getElementById('pauseWorkBtn').textContent=active?'▶ Продолжить':'Ⅱ Пауза';
  document.getElementById('shiftPauseValue').textContent=active?`${formatTime24(active.start)} (идёт)`:(day.pauses?.length?day.pauses.map(p=>`${formatTime24(p.start)}–${formatTime24(p.end)}`).join(', '):'—');
  const mins=workIntervals(day).reduce((sum,[a,b])=>sum+(b-a)*60,0);
  document.getElementById('shiftWorkedValue').textContent=minutesToLabel(mins);
  document.getElementById('shiftStartEdit').value=day.start||'';
  document.getElementById('shiftEndEdit').value=day.end||'';
  document.getElementById('pauseList').innerHTML=(day.pauses||[]).map((p,i)=>`<div class="pause-row"><span>${formatTime24(p.start)} – ${formatTime24(p.end||'')} </span><button type="button" class="text-btn" data-pause-edit="${i}">Редактировать</button><button type="button" class="text-btn danger-text" data-pause-delete="${i}">Удалить</button></div>`).join('');
  document.querySelectorAll('[data-pause-edit]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.pauseEdit),p=day.pauses[i];const st=prompt('Начало паузы (HH:MM)',p.start);if(st===null)return;const en=prompt('Конец паузы (HH:MM)',p.end||'');if(en===null)return; if(!validTime(st)||(en&& !validTime(en))){toast('Введите время в формате HH:MM');return;} p.start=normalizeTime(st);p.end=en?normalizeTime(en):'';saveState();});
  document.querySelectorAll('[data-pause-delete]').forEach(b=>b.onclick=()=>{day.pauses.splice(Number(b.dataset.pauseDelete),1);saveState();});
}
function validTime(v){ return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalizeTime(v)); }
function normalizeTime(v){const m=String(v||'').trim().match(/^(\d{1,2})[:.](\d{1,2})$/);return m?`${String(Number(m[1])).padStart(2,'0')}:${String(Number(m[2])).padStart(2,'0')}`:String(v||'').trim();}
function initShiftControls(){
  document.getElementById('startWorkBtn').onclick=()=>{const k=currentShiftKey();state.workDays=state.workDays||{};state.workDays[k]=state.workDays[k]||{pauses:[]};state.workDays[k].start=currentTime24();state.workDays[k].end='';saveState();toast('Рабочий день начат');};
  document.getElementById('pauseWorkBtn').onclick=()=>{const k=currentShiftKey();state.workDays=state.workDays||{};const d=state.workDays[k]||{pauses:[]};d.pauses=d.pauses||[];const active=d.pauses.find(p=>p.start&&!p.end);if(active){active.end=currentTime24();}else{if(!d.start){toast('Сначала нажмите «Начало рабочего дня»');return;}d.pauses.push({start:currentTime24(),end:''});}state.workDays[k]=d;saveState();};
  document.getElementById('endWorkBtn').onclick=()=>{const k=currentShiftKey();state.workDays=state.workDays||{};const d=state.workDays[k]||{pauses:[]};const active=d.pauses?.find(p=>p.start&&!p.end);if(active)active.end=currentTime24();if(!d.start){toast('Сначала начните рабочий день');return;}d.end=currentTime24();state.workDays[k]=d;saveState();toast('Рабочий день завершён');};
  document.getElementById('saveShiftEditBtn').onclick=()=>{const k=currentShiftKey();state.workDays=state.workDays||{};const d=state.workDays[k]||{pauses:[]};const st=document.getElementById('shiftStartEdit').value,en=document.getElementById('shiftEndEdit').value;if(st&&!validTime(st)||(en&&!validTime(en))){toast('Введите время в формате HH:MM');return;}d.start=st?normalizeTime(st):'';d.end=en?normalizeTime(en):'';d.pauses=d.pauses||[];state.workDays[k]=d;saveState();toast('Время смены сохранено');};
}

function download(name,text,type){
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
document.getElementById("exportBackupBtn").onclick=()=>download(`мебельщик_backup_${todayISO()}.json`,JSON.stringify(state,null,2),"application/json");
document.getElementById("exportCsvBtn").onclick=()=>{
  const rows=[["Статус","Номер заказа","Дата начала","Время начала","Дата выполнения","Время выполнения","Что сделано","Доход","Часы на сегодня","Доход в час","Комментарий"]];
  state.orders.forEach(o=>{const h=orderHours(o,{pastOnly:true});rows.push([isCompleted(o)?"Завершён":"В процессе",o.number,o.startDate,o.startTime,o.endDate,o.endTime,o.work,o.income,h,isCompleted(o)&&h?o.income/h:0,o.comment]);});
  const csv="\uFEFF"+rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(";")).join("\n");
  download(`заказы_${todayISO()}.csv`,csv,"text/csv;charset=utf-8");
};
document.getElementById("importBackupInput").onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());if(!Array.isArray(data.orders)||!data.settings)throw new Error();
    state=migrateState(data);saveState();toast("Резервная копия загружена");
  }catch(err){toast("Не удалось прочитать резервную копию");}
  e.target.value="";
};
document.getElementById("resetBtn").onclick=()=>{
  if(!confirm("Сбросить все изменения и вернуть исходные данные?"))return;
  state=migrateState(clone(window.APP_SEED));saveState();toast("Исходные данные восстановлены");
};
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;document.getElementById("installBtn").classList.remove("hidden");});
document.getElementById("installBtn").onclick=async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;document.getElementById("installBtn").classList.add("hidden");};
if("serviceWorker" in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("sw.js");
initShiftControls();
renderAll();
