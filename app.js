
const STORAGE_KEY = "furniture-income-app-v1";
const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

let state = loadState();
let deferredInstallPrompt = null;

function clone(value){ return JSON.parse(JSON.stringify(value)); }
function loadState(){
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch(e) {}
  return clone(window.APP_SEED);
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
function money(value){
  return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0}).format(Number(value)||0)+" ₽";
}
function number(value, digits=1){
  return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:digits}).format(Number(value)||0);
}
function parseTime(value){
  if(!value) return 0;
  const [h,m]=value.split(":").map(Number);
  return h + m/60;
}
function toISODate(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function parseDate(s){ return new Date(`${s}T12:00:00`); }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function mondayISO(date){
  const d=new Date(date); const day=(d.getDay()+6)%7;
  return toISODate(addDays(d,-day));
}
function weekendHours(date){
  const cfg=state.weekendHours[mondayISO(date)] || {sat:0,sun:0};
  return date.getDay()===6 ? Number(cfg.sat)||0 : Number(cfg.sun)||0;
}
function standardHours(){
  return Math.max(0,parseTime(state.settings.standardEnd)-parseTime(state.settings.standardStart));
}
function dailyBreakdown(order){
  if(!order.startDate || !order.endDate) return [];
  const start=parseDate(order.startDate), end=parseDate(order.endDate);
  if(end<start) return [];
  const out=[];
  for(let d=new Date(start); d<=end; d=addDays(d,1)){
    const dow=d.getDay();
    let hours=0;
    if(dow===0 || dow===6){
      hours=weekendHours(d);
    } else {
      const same=toISODate(d)===order.startDate && toISODate(d)===order.endDate;
      const first=toISODate(d)===order.startDate;
      const last=toISODate(d)===order.endDate;
      if(same) hours=Math.max(0,parseTime(order.endTime)-parseTime(order.startTime));
      else if(first) hours=Math.max(0,parseTime(state.settings.standardEnd)-parseTime(order.startTime));
      else if(last) hours=Math.max(0,parseTime(order.endTime)-parseTime(state.settings.standardStart));
      else hours=standardHours();
    }
    out.push({date:toISODate(d),hours});
  }
  return out;
}
function orderHours(order){ return dailyBreakdown(order).reduce((s,x)=>s+x.hours,0); }
function analytics(year){
  const months=Array.from({length:12},(_,i)=>({month:i,hours:0,income:0,days:0}));
  for(const order of state.orders){
    const days=dailyBreakdown(order);
    const total=days.reduce((s,x)=>s+x.hours,0);
    if(total<=0) continue;
    const byMonth={};
    for(const day of days){
      const d=parseDate(day.date);
      if(d.getFullYear()!==year) continue;
      const m=d.getMonth();
      byMonth[m]=(byMonth[m]||0)+day.hours;
    }
    for(const [m,h] of Object.entries(byMonth)){
      months[Number(m)].hours+=h;
      months[Number(m)].income+=(Number(order.income)||0)*h/total;
    }
  }
  const today=new Date();
  for(let m=0;m<12;m++){
    let d=new Date(year,m,1,12);
    const monthEnd=new Date(year,m+1,1,12);
    const limit=today<monthEnd ? addDays(today,1) : monthEnd;
    if(d>=limit) continue;
    while(d<limit){
      const dow=d.getDay();
      if((dow>=1&&dow<=5) || ((dow===0||dow===6)&&weekendHours(d)>0)) months[m].days++;
      d=addDays(d,1);
    }
  }
  return months;
}
function availableYears(){
  const years=new Set([new Date().getFullYear()]);
  state.orders.forEach(o=>{
    if(o.startDate) years.add(parseDate(o.startDate).getFullYear());
    if(o.endDate) years.add(parseDate(o.endDate).getFullYear());
  });
  Object.keys(state.weekendHours).forEach(k=>years.add(parseDate(k).getFullYear()));
  return [...years].sort((a,b)=>b-a);
}
function fillYearSelects(){
  const years=availableYears();
  for(const id of ["yearSelect","calendarYearSelect"]){
    const el=document.getElementById(id);
    const current=Number(el.value)||new Date().getFullYear();
    el.innerHTML=years.map(y=>`<option value="${y}">${y}</option>`).join("");
    el.value=years.includes(current)?current:years[0];
  }
}
function renderDashboard(){
  const year=Number(document.getElementById("yearSelect").value)||new Date().getFullYear();
  const data=analytics(year);
  const total=data.reduce((a,m)=>({hours:a.hours+m.hours,income:a.income+m.income,days:a.days+m.days}),{hours:0,income:0,days:0});
  document.getElementById("yearIncome").textContent=money(total.income);
  document.getElementById("yearHours").textContent=number(total.hours,1);
  document.getElementById("avgHour").textContent=money(total.hours?total.income/total.hours:0);
  document.getElementById("avgDay").textContent=money(total.days?total.income/total.days:0);
  document.getElementById("elapsedDays").textContent=total.days;
  document.getElementById("yearMeta").textContent=`${state.orders.length} заказов · ${number(total.hours,1)} часов`;
  const maxIncome=Math.max(1,...data.map(m=>m.income));
  document.getElementById("monthsList").innerHTML=data.map(m=>`
    <div class="month-row">
      <div class="month-name">${MONTHS[m.month]}</div>
      <div>
        <div><strong>${money(m.income)}</strong></div>
        <div class="month-bar"><i style="width:${Math.max(0,m.income/maxIncome*100)}%"></i></div>
      </div>
      <div class="month-stats">
        <strong>${number(m.hours,1)} ч</strong>
        <span>${money(m.days?m.income/m.days:0)} / день · ${m.days} дн.</span>
      </div>
    </div>`).join("");
}
function renderOrders(){
  const q=document.getElementById("orderSearch").value.trim().toLowerCase();
  const rows=[...state.orders].sort((a,b)=>(b.startDate||"").localeCompare(a.startDate||""))
    .filter(o=>`${o.number} ${o.work} ${o.comment}`.toLowerCase().includes(q));
  const list=document.getElementById("ordersList");
  list.innerHTML=rows.map(o=>{
    const h=orderHours(o), per=h?(Number(o.income)||0)/h:0;
    return `<article class="order-card" data-id="${o.id}">
      <div>
        <div class="order-title">Заказ ${escapeHtml(o.number)}</div>
        <div class="order-work">${escapeHtml(o.work||"Без описания")}</div>
        <div class="order-meta"><span>${formatDate(o.startDate)} → ${formatDate(o.endDate)}</span><span>${number(h,1)} ч</span><span>${money(per)}/ч</span></div>
      </div>
      <div class="order-money">${money(o.income)}<small>${escapeHtml(o.comment||"")}</small></div>
    </article>`;
  }).join("");
  document.getElementById("ordersEmpty").classList.toggle("hidden",rows.length>0);
  list.querySelectorAll(".order-card").forEach(el=>el.onclick=()=>openOrder(el.dataset.id));
}
function renderCalendar(){
  const year=Number(document.getElementById("calendarYearSelect").value)||new Date().getFullYear();
  let d=new Date(year,0,1,12);
  d=addDays(d,-((d.getDay()+6)%7));
  const end=new Date(year,11,31,12);
  const cards=[];
  while(d<=end){
    const mon=new Date(d), sat=addDays(mon,5), sun=addDays(mon,6), key=toISODate(mon);
    const cfg=state.weekendHours[key]||{sat:0,sun:0};
    if(sun.getFullYear()>=year && mon.getFullYear()<=year){
      cards.push(`<article class="week-card">
        <div class="week-title">${formatDate(key)} — ${formatDate(toISODate(sun))}</div>
        <div class="week-fields">
          <label>Сб, ${formatDate(toISODate(sat))}<input class="week-hour" data-key="${key}" data-day="sat" type="number" min="0" max="24" step="0.5" value="${Number(cfg.sat)||0}"></label>
          <label>Вс, ${formatDate(toISODate(sun))}<input class="week-hour" data-key="${key}" data-day="sun" type="number" min="0" max="24" step="0.5" value="${Number(cfg.sun)||0}"></label>
        </div>
      </article>`);
    }
    d=addDays(d,7);
  }
  const list=document.getElementById("weeksList");
  list.innerHTML=cards.join("");
  list.querySelectorAll(".week-hour").forEach(el=>el.onchange=()=>{
    const key=el.dataset.key, day=el.dataset.day;
    if(!state.weekendHours[key]) state.weekendHours[key]={sat:0,sun:0};
    state.weekendHours[key][day]=Math.max(0,Math.min(24,Number(el.value)||0));
    saveState(); toast("Часы выходного сохранены");
  });
}
function renderSettings(){
  document.getElementById("standardStart").value=state.settings.standardStart;
  document.getElementById("standardEnd").value=state.settings.standardEnd;
}
function renderAll(){
  fillYearSelects();
  renderDashboard(); renderOrders(); renderCalendar(); renderSettings();
}
function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}
function formatDate(s){
  if(!s) return "—";
  return new Intl.DateTimeFormat("ru-RU",{day:"2-digit",month:"2-digit",year:"2-digit"}).format(parseDate(s));
}
function openOrder(id=null){
  const form=document.getElementById("orderForm"); form.reset();
  const order=id?state.orders.find(o=>o.id===id):null;
  document.getElementById("orderDialogTitle").textContent=order?"Редактировать заказ":"Новый заказ";
  document.getElementById("deleteOrderBtn").classList.toggle("hidden",!order);
  document.getElementById("orderId").value=order?.id||"";
  document.getElementById("orderNumber").value=order?.number||"";
  document.getElementById("startDate").value=order?.startDate||toISODate(new Date());
  document.getElementById("endDate").value=order?.endDate||toISODate(new Date());
  document.getElementById("startTime").value=order?.startTime||state.settings.standardStart;
  document.getElementById("endTime").value=order?.endTime||state.settings.standardEnd;
  document.getElementById("workDone").value=order?.work||"";
  document.getElementById("income").value=order?.income||"";
  document.getElementById("comment").value=order?.comment||"";
  updateOrderPreview();
  document.getElementById("orderDialog").showModal();
}
function formOrder(){
  return {
    id:document.getElementById("orderId").value||crypto.randomUUID(),
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
  const o=formOrder(), h=orderHours(o), per=h?o.income/h:0;
  document.getElementById("orderPreview").textContent=`Расчёт: ${number(h,1)} ч · ${money(per)} в час`;
}
document.querySelectorAll(".nav-btn").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".nav-btn").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active"); document.getElementById(btn.dataset.view).classList.add("active");
  scrollTo({top:0,behavior:"smooth"});
});
document.getElementById("addOrderBtn").onclick=()=>openOrder();
document.getElementById("closeOrderDialog").onclick=()=>document.getElementById("orderDialog").close();
document.getElementById("orderForm").onsubmit=e=>{
  e.preventDefault();
  const o=formOrder();
  if(parseDate(o.endDate)<parseDate(o.startDate)){ toast("Дата окончания раньше даты начала"); return; }
  const idx=state.orders.findIndex(x=>x.id===o.id);
  if(idx>=0) state.orders[idx]={...state.orders[idx],...o}; else state.orders.push(o);
  saveState(); document.getElementById("orderDialog").close(); toast("Заказ сохранён");
};
document.getElementById("deleteOrderBtn").onclick=()=>{
  const id=document.getElementById("orderId").value;
  if(!id || !confirm("Удалить заказ?")) return;
  state.orders=state.orders.filter(o=>o.id!==id); saveState();
  document.getElementById("orderDialog").close(); toast("Заказ удалён");
};
["startDate","endDate","startTime","endTime","income"].forEach(id=>document.getElementById(id).addEventListener("input",updateOrderPreview));
document.getElementById("orderSearch").oninput=renderOrders;
document.getElementById("yearSelect").onchange=renderDashboard;
document.getElementById("calendarYearSelect").onchange=renderCalendar;
document.getElementById("saveSettingsBtn").onclick=()=>{
  const start=document.getElementById("standardStart").value, end=document.getElementById("standardEnd").value;
  if(parseTime(end)<=parseTime(start)){ toast("Конец дня должен быть позже начала"); return; }
  state.settings={standardStart:start,standardEnd:end}; saveState(); toast("График сохранён");
};
function download(name,text,type){
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
document.getElementById("exportBackupBtn").onclick=()=>download(`мебельщик_backup_${toISODate(new Date())}.json`,JSON.stringify(state,null,2),"application/json");
document.getElementById("exportCsvBtn").onclick=()=>{
  const rows=[["Номер заказа","Дата начала","Время начала","Дата окончания","Время окончания","Что сделано","Доход","Часы","Доход в час","Комментарий"]];
  state.orders.forEach(o=>{const h=orderHours(o); rows.push([o.number,o.startDate,o.startTime,o.endDate,o.endTime,o.work,o.income,h,h?o.income/h:0,o.comment]);});
  const csv="\uFEFF"+rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(";")).join("\n");
  download(`заказы_${toISODate(new Date())}.csv`,csv,"text/csv;charset=utf-8");
};
document.getElementById("importBackupInput").onchange=async e=>{
  const file=e.target.files[0]; if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(!Array.isArray(data.orders)||!data.settings||!data.weekendHours) throw new Error();
    state=data; saveState(); toast("Резервная копия загружена");
  }catch(err){ toast("Не удалось прочитать резервную копию"); }
  e.target.value="";
};
document.getElementById("resetBtn").onclick=()=>{
  if(!confirm("Сбросить все изменения и вернуть данные из Excel?"))return;
  state=clone(window.APP_SEED); saveState(); toast("Исходные данные восстановлены");
};
window.addEventListener("beforeinstallprompt",e=>{
  e.preventDefault(); deferredInstallPrompt=e; document.getElementById("installBtn").classList.remove("hidden");
});
document.getElementById("installBtn").onclick=async()=>{
  if(!deferredInstallPrompt)return;
  deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt=null;
  document.getElementById("installBtn").classList.add("hidden");
};
if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js");
renderAll();
