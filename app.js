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

function minutesToTime(total){
  total=((Math.round(Number(total)||0)%1440)+1440)%1440;
  return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
}
function timeToMinutes(t){ return parseTime(t); }
function workIntervalsForDate(date){
  const key=typeof date==="string"?date:toISODate(date);
  const wd=state.workDays?.[key];
  if(!wd||!wd.start) return [];
  let start=timeToMinutes(wd.start), end=wd.end?timeToMinutes(wd.end):timeToMinutes(currentTime());
  if(end<=start) end+=1440;
  const now=key===todayISO()?timeToMinutes(currentTime()):1440;
  if(!wd.end) end=Math.max(end,now);
  const pauses=(wd.pauses||[]).map(p=>{
    if(!p?.start) return null;
    let ps=timeToMinutes(p.start), pe=p.end?timeToMinutes(p.end):now;
    if(pe<=ps) pe+=1440;
    return {start:ps,end:Math.min(pe,end)};
  }).filter(p=>p&&p.end>p.start);
  let intervals=[[start,end]];
  for(const p of pauses){
    const next=[];
    for(const [a,b] of intervals){
      if(p.end<=a||p.start>=b){next.push([a,b]);continue;}
      if(p.start>a) next.push([a,Math.min(p.start,b)]);
      if(p.end<b) next.push([Math.max(p.end,a),b]);
    }
    intervals=next;
  }
  return intervals.filter(x=>x[1]>x[0]);
}
function workedMinutesForDate(key){
  return workIntervalsForDate(key).reduce((sum,[a,b])=>sum+(b-a),0);
}
function overlapMinutes(aStart,aEnd,bStart,bEnd){
  let a=aStart,b=aEnd;
  if(b<=a) b+=1440;
  let total=0;
  for(const shift of workIntervalsForDate(aStart.date||"")){
    total+=Math.max(0,Math.min(b,shift[1])-Math.max(a,shift[0]));
  }
  return total;
}
function orderDayHours(order,key){
  const startKey=order.startDate;
  const endKey=order.endDate||todayISO();
  if(!startKey||key<startKey||key>endKey) return 0;
  const intervals=workIntervalsForDate(key);
  if(!intervals.length) return 0;
  let os=0,oe=1440;
  if(key===startKey) os=parseTime(order.startTime);
  if(key===endKey){
    oe=order.endTime?parseTime(order.endTime):timeToMinutes(currentTime());
  }
  if(key===startKey&&key===endKey&&oe<=os) return 0;
  if(oe<=os&&key===endKey) oe+=1440;
  return intervals.reduce((sum,[a,b])=>sum+Math.max(0,Math.min(oe,b)-Math.max(os,a)),0)/60;
}
function standardHours(){ return Math.max(0,parseTime(state.settings.standardEnd)-parseTime(state.settings.standardStart)); }
function legacyWeekendHours(date){
  const cfg=state.weekendHours[mondayISO(date)]||{sat:0,sun:0};
  return date.getDay()===6?Number(cfg.sat)||0:Number(cfg.sun)||0;
}
function scheduledHours(date){
  const key=toISODate(date);
  if(state.workDays?.[key]?.start&&state.workDays?.[key]?.end) return workedMinutesForDate(key)/60;
  if(Object.prototype.hasOwnProperty.call(state.dailyHours,key)) return Math.max(0,Number(state.dailyHours[key])||0);
  const dow=date.getDay();
  if(dow===0||dow===6) return legacyWeekendHours(date);
  return standardHours();
}
function isCompleted(order){ return (order.status||"completed")==="completed"; }
function dailyBreakdown(order,{pastOnly=false}={}){
  if(!order.startDate) return [];
  const endKey=order.endDate||todayISO();
  const start=parseDate(order.startDate),end=parseDate(endKey);
  if(end<start) return [];
  const out=[],today=todayISO();
  for(let d=new Date(start);d<=end;d=addDays(d,1)){
    const iso=toISODate(d);
    if(pastOnly&&iso>today) continue;
    let hours=orderDayHours(order,iso);
    // For an old record with no explicit work-day entry, keep the legacy calculation.
    if(!state.workDays?.[iso]){
      const scheduled=scheduledHours(d);
      const same=iso===order.startDate&&iso===order.endDate;
      const first=iso===order.startDate,last=iso===order.endDate;
      if(same) hours=Math.max(0,parseTime(order.endTime)-parseTime(order.startTime))/60;
      else if(first) hours=Math.max(0,parseTime(state.settings.standardEnd)-parseTime(order.startTime))/60;
      else if(last) hours=Math.max(0,parseTime(order.endTime)-parseTime(state.settings.standardStart))/60;
      else hours=scheduled;
      if(scheduled===0) hours=0;
      else if(!same&&(first||last)) hours=Math.min(hours,scheduled);
    }
    out.push({date:iso,hours});
  }
  return out;
}
function orderHours(order,options){ return dailyBreakdown(order,options).reduce((s,x)=>s+x.hours,0); }

function analytics(year){
  const months=Array.from({length:12},(_,i)=>({month:i,hours:0,income:0,dates:new Set()}));
  const incomeByMonth=Array(12).fill(0);
  const activeDates=Array.from({length:12},()=>new Set());
  for(const order of state.orders.filter(isCompleted)){
    const days=dailyBreakdown(order,{pastOnly:true}).filter(x=>x.hours>0);
    const total=days.reduce((sum,x)=>sum+x.hours,0);
    if(total<=0) continue;
    for(const day of days){
      const d=parseDate(day.date);
      if(d.getFullYear()!==year) continue;
      const m=d.getMonth();
      incomeByMonth[m]+=(Number(order.income)||0)*day.hours/total;
      activeDates[m].add(day.date);
    }
  }
  for(let m=0;m<12;m++){
    months[m].income=incomeByMonth[m];
    for(const date of activeDates[m]){
      months[m].dates.add(date);
      months[m].hours+=state.workDays?.[date]?workedMinutesForDate(date)/60:scheduledHours(parseDate(date));
    }
    months[m].days=months[m].dates.size;
  }
  return months;
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
      const key=toISODate(d), wd=state.workDays?.[key]||{};
      const future=key>todayISO();
      const isToday=key===todayISO();
      const paused=(wd.pauses||[]).some(p=>p.start&&!p.end);
      const worked=workedMinutesForDate(key)/60;
      days.push(`
        <article class="workday-card ${future?"future-day":""} ${isToday?"today-workday":""}">
          <div class="workday-head">
            <div><strong>${WEEKDAYS[d.getDay()]}, ${String(d.getDate()).padStart(2,"0")}.${String(m+1).padStart(2,"0")}.${year}</strong>
            <small>${worked?`Отработано: ${number(worked,2)} ч`:"Рабочий день не начат"}</small></div>
            ${paused?'<span class="status-badge">Пауза</span>':""}
          </div>
          <div class="workday-actions">
            <button type="button" class="primary work-action" data-action="start" data-date="${key}" ${wd.start&&wd.end?"disabled":""}>▶ Начало рабочего дня</button>
            <button type="button" class="secondary work-action" data-action="pause" data-date="${key}" ${!wd.start||wd.end?"disabled":""}>${paused?"▶ Продолжить":"Ⅱ Пауза"}</button>
            <button type="button" class="secondary work-action" data-action="end" data-date="${key}" ${!wd.start||wd.end?"disabled":""}>■ Конец рабочего дня</button>
          </div>
          <div class="two-cols compact-fields">
            <label>Начало<input class="work-edit-start" data-date="${key}" type="time" value="${wd.start||""}"></label>
            <label>Конец<input class="work-edit-end" data-date="${key}" type="time" value="${wd.end||""}"></label>
          </div>
          <div class="pause-list">
            ${(wd.pauses||[]).map((p,i)=>`<div class="pause-row">
              <span>Пауза ${i+1}</span>
              <input class="pause-start" data-date="${key}" data-index="${i}" type="time" value="${p.start||""}">
              <span>—</span>
              <input class="pause-end" data-date="${key}" data-index="${i}" type="time" value="${p.end||""}">
              <button type="button" class="icon-btn delete-pause" data-date="${key}" data-index="${i}">×</button>
            </div>`).join("")}
          </div>
          <button type="button" class="secondary add-pause" data-date="${key}">+ Добавить паузу</button>
        </article>`);
    }
    months.push(`<details class="month-hours" ${m===new Date().getMonth()&&year===new Date().getFullYear()?"open":""}><summary>${MONTHS[m]}</summary><div class="workdays-grid">${days.join("")}</div></details>`);
  }
  const list=document.getElementById("weeksList"); list.innerHTML=months.join("");
  list.querySelectorAll(".work-action").forEach(btn=>btn.onclick=()=>{
    const key=btn.dataset.date,action=btn.dataset.action;
    const wd=state.workDays[key]||{start:"",end:"",pauses:[],closed:false};
    const now=currentTime();
    if(action==="start"){ wd.start=now; wd.end=""; wd.closed=false; wd.pauses=[]; }
    if(action==="pause"){
      const open=(wd.pauses||[]).find(p=>p.start&&!p.end);
      if(open) open.end=now; else (wd.pauses||(wd.pauses=[])).push({start:now,end:""});
    }
    if(action==="end"){
      const open=(wd.pauses||[]).find(p=>p.start&&!p.end); if(open) open.end=now;
      wd.end=now; wd.closed=true;
    }
    wd.updatedAt=new Date().toISOString(); state.workDays[key]=wd; saveState(); toast(action==="start"?"Рабочий день начат":action==="pause"?"Пауза переключена":"Рабочий день завершён");
  });
  list.querySelectorAll(".work-edit-start,.work-edit-end").forEach(el=>el.onchange=()=>{
    const key=el.dataset.date,wd=state.workDays[key]||{start:"",end:"",pauses:[],closed:false};
    wd[el.classList.contains("work-edit-start")?"start":"end"]=el.value; state.workDays[key]=wd; saveState(); toast("Рабочее время изменено");
  });
  list.querySelectorAll(".add-pause").forEach(btn=>btn.onclick=()=>{
    const key=btn.dataset.date,wd=state.workDays[key]||{start:"",end:"",pauses:[],closed:false};
    (wd.pauses||(wd.pauses=[])).push({start:"",end:""}); state.workDays[key]=wd; saveState();
  });
  list.querySelectorAll(".pause-start,.pause-end").forEach(el=>el.onchange=()=>{
    const wd=state.workDays[el.dataset.date]; if(!wd)return;
    const p=wd.pauses[Number(el.dataset.index)]; p[el.classList.contains("pause-start")?"start":"end"]=el.value;
    saveState(); toast("Пауза изменена");
  });
  list.querySelectorAll(".delete-pause").forEach(btn=>btn.onclick=()=>{
    const wd=state.workDays[btn.dataset.date]; if(!wd)return;
    wd.pauses.splice(Number(btn.dataset.index),1); saveState(); toast("Пауза удалена");
  });
}
function renderSettings(){
  document.getElementById("standardStart").value=state.settings.standardStart;
  document.getElementById("standardEnd").value=state.settings.standardEnd;
}
function renderAll(){ fillYearSelects(); renderDashboard(); renderOrders(); renderProgress(); renderCalendar(); renderSettings(); }
function escapeHtml(value){ return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
function formatDate(s){
  if(!s) return "—";
  return new Intl.DateTimeFormat("ru-RU",{day:"2-digit",month:"2-digit",year:"2-digit"}).format(parseDate(s));
}
function syncStatusFields(){
  const inProgress=document.getElementById("orderStatus").checked;
  const endWrap=document.getElementById("completionFields");
  endWrap.classList.toggle("hidden",inProgress);
  document.getElementById("endDate").required=!inProgress;
  document.getElementById("endTime").required=!inProgress;
  document.getElementById("incomeHelp").classList.toggle("hidden",!inProgress);
  updateOrderPreview();
}
function openOrder(id){
  const order=state.orders.find(o=>o.id===id);
  document.getElementById("orderDialogTitle").textContent=order?"Редактировать заказ":"Новый заказ";
  document.getElementById("orderId").value=order?.id||"";
  document.getElementById("orderStatus").checked=(order?.status||"completed")==="in_progress";
  document.getElementById("orderNumber").value=order?.number||"";
  document.getElementById("startDate").value=order?.startDate||todayISO();
  document.getElementById("endDate").value=order?.endDate||todayISO();
  document.getElementById("startTime").value=order?.startTime||currentTime();
  document.getElementById("endTime").value=order?.endTime||currentTime();
  document.getElementById("workDone").value=order?.work||"";
  document.getElementById("income").value=order?.income??"";
  document.getElementById("comment").value=order?.comment||"";
  syncStatusFields();
  document.getElementById("orderDialog").showModal();
}
function formOrder(){
  const inProgress=document.getElementById("orderStatus").checked;
  return {
    id:document.getElementById("orderId").value||crypto.randomUUID(),
    status:inProgress?"in_progress":"completed",
    number:document.getElementById("orderNumber").value.trim(),
    startDate:document.getElementById("startDate").value,
    startTime:document.getElementById("startTime").value,
    endDate:inProgress?"":document.getElementById("endDate").value,
    endTime:inProgress?"":document.getElementById("endTime").value,
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
  if(o.status==="completed"&&(!o.endDate||!o.endTime)){toast("Для завершённого заказа укажите время окончания");return;}
  if(o.status==="completed"&&parseDate(o.endDate)<parseDate(o.startDate)){toast("Дата выполнения раньше даты начала");return;}
  const idx=state.orders.findIndex(x=>x.id===o.id);
  if(idx>=0) state.orders[idx]={...state.orders[idx],...o}; else state.orders.push(o);
  saveState();document.getElementById("orderDialog").close();toast("Заказ сохранён");
};
document.getElementById("deleteOrderBtn").onclick=()=>{
  const id=document.getElementById("orderId").value;
  if(!id||!confirm("Удалить заказ?"))return;
  state.orders=state.orders.filter(o=>o.id!==id);saveState();document.getElementById("orderDialog").close();toast("Заказ удалён");
};
["startDate","endDate","startTime","endTime","income"].forEach(id=>document.getElementById(id).addEventListener("input",updateOrderPreview));
document.getElementById("orderStatus").addEventListener("change",syncStatusFields);
document.querySelectorAll(".now-btn").forEach(btn=>btn.onclick=()=>{
  const target=document.getElementById(btn.dataset.target);
  target.value=currentTime(); target.dispatchEvent(new Event("input",{bubbles:true}));
});
document.getElementById("orderSearch").oninput=renderOrders;
document.getElementById("progressSearch").oninput=renderProgress;
document.getElementById("yearSelect").onchange=renderDashboard;
document.getElementById("calendarYearSelect").onchange=renderCalendar;
document.getElementById("saveSettingsBtn").onclick=()=>{
  const start=document.getElementById("standardStart").value,end=document.getElementById("standardEnd").value;
  if(parseTime(end)<=parseTime(start)){toast("Конец дня должен быть позже начала");return;}
  state.settings={standardStart:start,standardEnd:end};saveState();toast("График сохранён");
};
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
renderAll();
