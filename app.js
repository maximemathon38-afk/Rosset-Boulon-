
const cfg=window.RBF_CONFIG||{};
let sb=null;
let state={chefs:[],containers:[],catalog:[],items:[],units:[],history:[]};
let session={type:null,chefId:null,containerId:null,name:null};
let adminTab="containers";
let refreshTimer=null;
let realtimeChannel=null;

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const now=()=>new Date().toISOString();
const fmtDate=s=>s?new Date(s).toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short"}):"—";

function configured(){return Boolean((cfg.SUPABASE_URL||"").trim()&&(cfg.SUPABASE_PUBLISHABLE_KEY||"").trim())}
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.remove("hidden");clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.add("hidden"),2800)}
function setSync(ok,label){const el=$("#syncState");if(!el)return;el.className="sync "+(ok?"online":"offline");el.querySelector(".sync-label").textContent=label||(ok?"Synchronisé":"Hors connexion")}
function chefName(c){return state.chefs.find(x=>x.id===c.chief_id)?.name||"Chef"}
function itemsFor(cid){return state.items.filter(x=>x.container_id===cid)}
function currentContainer(){return state.containers.find(x=>x.id===session.containerId)}
function getItem(id){return state.items.find(x=>x.id===id)}
function unitsFor(itemId){return state.units.filter(x=>x.container_item_id===itemId).sort((a,b)=>a.unit_no-b.unit_no)}
function containerStats(c){let p=0,r=0,m=0,e=0;for(const i of itemsFor(c.id)){e+=+i.expected||0;p+=+i.present||0;r+=+i.repair||0;m+=Math.max((+i.expected||0)-(+i.present||0)-(+i.repair||0),0)}return{p,r,m,e}}
function itemStatus(i){const m=Math.max(i.expected-i.present-i.repair,0);if(m>0)return["danger",`${m} manquant${m>1?"s":""}`];if(i.repair>0)return["warning",`${i.repair} en réparation`];return["good","Complet"]}
function modal(title,body,footer=""){$("#modalRoot").innerHTML=`<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-head"><h3>${title}</h3><button class="close" onclick="closeModal()">×</button></div><div class="modal-body">${body}</div>${footer?`<div class="modal-foot">${footer}</div>`:""}</div></div>`}
function closeModal(){$("#modalRoot").innerHTML=""}
function showApp(){$("#loginView").classList.add("hidden");$("#appView").classList.remove("hidden")}
function logout(){session={type:null,chefId:null,containerId:null,name:null};$("#appView").classList.add("hidden");$("#loginView").classList.remove("hidden")}

async function loadAll({quiet=false}={}){
  if(!sb)return false;
  try{
    const [a,b,c,d,u,e]=await Promise.all([
      sb.from("chefs").select("*").order("name"),
      sb.from("containers").select("*").order("name"),
      sb.from("catalog").select("*").order("name"),
      sb.from("container_items").select("*").order("name"),
      sb.from("equipment_units").select("*").order("unit_no"),
      sb.from("history").select("*").order("created_at",{ascending:false}).limit(300)
    ]);
    for(const r of[a,b,c,d,u,e])if(r.error)throw r.error;
    state={chefs:a.data||[],containers:b.data||[],catalog:c.data||[],items:d.data||[],units:u.data||[],history:e.data||[]};
    renderNames();
    if(session.type==="chef")renderChef();
    if(session.type==="admin")session.containerId?renderAdminContainer(session.containerId):renderAdmin();
    setSync(true,"Synchronisé");
    return true;
  }catch(err){
    console.error(err);setSync(false,"Erreur synchro");if(!quiet)toast("Erreur de synchronisation : "+(err.message||""));return false;
  }
}

function subscribeRealtime(){
  if(!sb)return;
  if(realtimeChannel)sb.removeChannel(realtimeChannel);
  let debounce=null;
  const refresh=()=>{clearTimeout(debounce);debounce=setTimeout(()=>loadAll({quiet:true}),250)};
  realtimeChannel=sb.channel("rbf-global-live")
    .on("postgres_changes",{event:"*",schema:"public",table:"container_items"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"containers"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"history"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"catalog"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"equipment_units"},refresh)
    .subscribe(status=>{if(status==="SUBSCRIBED")setSync(true,"Temps réel actif")});
}

function renderNames(){const root=$("#nameGrid");if(!root)return;root.innerHTML=state.chefs.length?state.chefs.map(ch=>`<button class="name-btn" onclick="loginChef('${ch.id}')">👷 ${esc(ch.name)}</button>`).join(""):'<div class="empty" style="grid-column:1/-1">Aucun chef trouvé dans Supabase.</div>'}
function loginChef(id){const ch=state.chefs.find(x=>x.id===id),c=state.containers.find(x=>x.chief_id===id);if(!ch||!c){toast("Container introuvable.");return}session={type:"chef",chefId:id,containerId:c.id,name:ch.name};$("#roleSmall").textContent=`${ch.name} · Chef de chantier`;showApp();renderChef()}
function loginAdminPrompt(){modal("Accès administrateur",`<div class="field"><label>Code administrateur</label><input id="adminCode" type="password" placeholder="Code"></div>`,`<button class="btn btn-light" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="loginAdmin()">Connexion</button>`)}
function loginAdmin(){if(($("#adminCode").value||"")!==String(cfg.ADMIN_CODE||"RBF2026")){toast("Code incorrect.");return}closeModal();session={type:"admin",name:"Administrateur",containerId:null};$("#roleSmall").textContent="Administrateur";showApp();renderAdmin()}

function statsCards(s){return `<div class="grid grid-3"><div class="card stat"><div><div class="stat-label">PRÉSENT</div><div class="stat-num">${s.p}</div></div><span class="dot ok"></span></div><div class="card stat"><div><div class="stat-label">EN RÉPARATION</div><div class="stat-num">${s.r}</div></div><span class="dot warn"></span></div><div class="card stat"><div><div class="stat-label">MANQUANT</div><div class="stat-num">${s.m}</div></div><span class="dot bad"></span></div></div>`}
function inventoryHTML(c){
  const rows=itemsFor(c.id).map(i=>{const missing=Math.max(i.expected-i.present-i.repair,0),[cl,txt]=itemStatus(i);return `<tr><td><div class="item-name">${esc(i.name)}</div><div class="muted">Prévu : ${i.expected}</div></td><td class="qty">${i.present}</td><td class="qty">${i.repair}</td><td class="qty">${missing}</td><td><span class="status ${cl}">${txt}</span></td><td><div class="actions"><button class="btn btn-light btn-sm" onclick="openCount('${i.id}')">✏️ Compter</button><button class="btn btn-danger btn-sm" onclick="openRepair('${i.id}')">🔧 Réparer</button>${i.repair>0?`<button class="btn btn-success btn-sm" onclick="openReturn('${i.id}')">↩ Retour</button>`:""}${i.requires_serial?`<button class="btn btn-accent btn-sm" onclick="openUnits('${i.id}')">#️⃣ N° série</button>`:""}<button class="btn btn-light btn-sm" onclick="openItemEdit('${i.id}')">⚙️ Modifier</button></div></td></tr>`}).join("");
  const cards=itemsFor(c.id).map(i=>{const missing=Math.max(i.expected-i.present-i.repair,0),[cl,txt]=itemStatus(i);return `<div class="item-card"><div class="item-head"><div><div class="item-name">${esc(i.name)}</div><div class="muted">Prévu : ${i.expected}</div></div><span class="status ${cl}">${txt}</span></div><div class="item-stats"><div class="mini"><b>${i.present}</b><span>Présent</span></div><div class="mini"><b>${i.repair}</b><span>Réparation</span></div><div class="mini"><b>${missing}</b><span>Manquant</span></div><div class="mini"><b>${i.expected}</b><span>Prévu</span></div></div><div class="actions"><button class="btn btn-light btn-sm" onclick="openCount('${i.id}')">✏️ Compter</button><button class="btn btn-danger btn-sm" onclick="openRepair('${i.id}')">🔧 Réparer</button>${i.repair>0?`<button class="btn btn-success btn-sm" onclick="openReturn('${i.id}')">↩ Retour</button>`:""}${i.requires_serial?`<button class="btn btn-accent btn-sm" onclick="openUnits('${i.id}')">#️⃣ N° série</button>`:""}<button class="btn btn-light btn-sm" onclick="openItemEdit('${i.id}')">⚙️ Modifier</button></div></div>`}).join("");
  return `<div class="table-card inventory"><table class="table"><thead><tr><th>Matériel</th><th>Présent</th><th>Réparation</th><th>Manquant</th><th>État</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div><div class="mobile-cards">${cards}</div>`;
}
function historyText(h){if(h.event_type==="repair")return `${h.qty} ${h.item_name} envoyé(s) en réparation`;if(h.event_type==="return")return `${h.qty} ${h.item_name} revenu(s) de réparation`;if(h.event_type==="count")return `Comptage : ${h.item_name}`;if(h.event_type==="item_add")return `Matériel ajouté : ${h.item_name}`;if(h.event_type==="item_edit")return `Matériel modifié : ${h.item_name}`;if(h.event_type==="item_delete")return `Matériel supprimé : ${h.item_name}`;if(h.event_type==="inventory")return"Inventaire validé";if(h.event_type==="serial_update")return `Suivi série / contrôle : ${h.item_name}`;return h.event_type}
function historyHTML(cid=null,limit=25){const h=state.history.filter(x=>!cid||x.container_id===cid).slice(0,limit);if(!h.length)return'<div class="card empty">Aucun mouvement enregistré.</div>';return `<div class="history">${h.map(x=>`<div class="history-row"><div class="history-icon">•</div><div class="history-main"><b>${esc(historyText(x))}</b><small>${esc(x.actor_name||"")} · ${fmtDate(x.created_at)}${x.note?" · "+esc(x.note):""}</small></div></div>`).join("")}</div>`}
function renderChef(){const c=currentContainer();if(!c)return;$("#adminScreen").classList.add("hidden");const root=$("#chefScreen");root.classList.remove("hidden");root.innerHTML=`<div class="brand-panel"><h2>Rosset Boulon &amp; Fils</h2><p>Inventaire et suivi du matériel de ${esc(c.name)}.</p><div class="brand-tags"><span class="brand-tag">${esc(session.name)}</span><span class="brand-tag">${esc(c.name)}</span></div></div><div class="hero"><div><span class="badge">${esc(c.name)}</span><h1>Mon container</h1><p>${c.location?esc(c.location)+" · ":""}Dernier inventaire : ${c.last_inventory?fmtDate(c.last_inventory):"jamais"}</p></div><div class="hero-actions"><button class="btn btn-light" onclick="loadAll()">↻ Actualiser</button><button class="btn btn-accent" onclick="openItemAdd()">＋ Ajouter matériel</button><button class="btn btn-primary" onclick="validateInventory()">✓ Valider inventaire</button></div></div>${statsCards(containerStats(c))}<div class="section-title"><h2>Inventaire</h2><span>${itemsFor(c.id).length} types de matériel</span></div>${inventoryHTML(c)}<div class="section-title"><h2>Historique</h2><span>Mises à jour en temps réel</span></div>${historyHTML(c.id,12)}`}
function renderAdmin(){ $("#chefScreen").classList.add("hidden");const root=$("#adminScreen");root.classList.remove("hidden");root.innerHTML=`<div class="brand-panel"><h2>Rosset Boulon &amp; Fils</h2><p>Suivi général des containers et des réparations.</p><div class="brand-tags"><span class="brand-tag">Administration</span><span class="brand-tag">Temps réel</span></div></div><div class="hero"><div><span class="badge">ADMIN</span><h1>Tableau de bord</h1><p>Les changements des chefs apparaissent automatiquement.</p></div><div class="hero-actions"><button class="btn btn-light" onclick="loadAll()">↻ Actualiser</button></div></div><div class="tabs"><button class="tab ${adminTab==="containers"?"active":""}" onclick="setAdminTab('containers')">Containers</button><button class="tab ${adminTab==="history"?"active":""}" onclick="setAdminTab('history')">Historique</button></div><div id="adminContent" style="margin-top:15px"></div>`;renderAdminTab()}
function setAdminTab(t){adminTab=t;renderAdmin()}
function renderAdminTab(){const root=$("#adminContent");if(adminTab==="history"){root.innerHTML=historyHTML(null,100);return}root.innerHTML=`<div class="grid grid-2">${state.containers.map(c=>{const s=containerStats(c),[cl,txt]=s.m?["danger",`${s.m} manquant(s)`]:s.r?["warning",`${s.r} en réparation`]:["good","OK"];return `<div class="card container-card" onclick="openAdminContainer('${c.id}')"><div class="container-title"><div><h3>${esc(chefName(c))}</h3><div class="muted">${esc(c.name)}${c.location?" · "+esc(c.location):""}</div></div><span class="status ${cl}">${txt}</span></div><div class="summary"><div><b>${s.p}</b><span>présents</span></div><div><b>${s.r}</b><span>réparation</span></div><div><b>${s.m}</b><span>manquants</span></div></div></div>`}).join("")}</div>`}
function openAdminContainer(id){session.containerId=id;renderAdminContainer(id)}
function renderAdminContainer(id){const c=state.containers.find(x=>x.id===id);if(!c)return;$("#chefScreen").classList.add("hidden");const root=$("#adminScreen");root.classList.remove("hidden");root.innerHTML=`<div class="hero"><div><button class="btn btn-light btn-sm" onclick="session.containerId=null;renderAdmin()">← Retour</button><h1 style="margin-top:12px">${esc(chefName(c))}</h1><p>${esc(c.name)}${c.location?" · "+esc(c.location):""}</p></div><div class="hero-actions"><button class="btn btn-light" onclick="openContainerMeta()">⚙️ Container</button><button class="btn btn-accent" onclick="openItemAdd()">＋ Ajouter matériel</button></div></div>${statsCards(containerStats(c))}<div class="section-title"><h2>Inventaire</h2><span>${itemsFor(c.id).length} types</span></div>${inventoryHTML(c)}<div class="section-title"><h2>Historique</h2></div>${historyHTML(c.id,30)}`}


async function ensureUnits(item){
  if(!item.requires_serial)return;
  const existing=unitsFor(item.id);
  const need=Math.max(+item.expected||0,1);
  const existingNos=new Set(existing.map(x=>x.unit_no));
  const rows=[];
  for(let n=1;n<=need;n++){
    if(!existingNos.has(n)) rows.push({container_item_id:item.id,unit_no:n});
  }
  if(rows.length){
    const {error}=await sb.from("equipment_units").insert(rows);
    if(error)throw error;
    await loadAll({quiet:true});
  }
}

async function openUnits(id){
  let item=getItem(id);if(!item)return;
  try{await ensureUnits(item);}catch(e){toast("Erreur unités : "+e.message);return}
  item=getItem(id);
  const units=unitsFor(id);
  const isLaser=!!item.requires_laser_control;
  const rows=units.map(u=>`
    <div style="padding:12px 0;border-bottom:1px solid var(--line)">
      <div class="item-name" style="margin-bottom:8px">Exemplaire ${u.unit_no}</div>
      <div class="form-grid">
        <div class="field ${isLaser?"":"full"}">
          <label>Numéro de série</label>
          <input id="serial_${u.id}" value="${esc(u.serial_number||"")}" placeholder="N° de série">
        </div>
        ${isLaser?`
        <div class="field">
          <label>Date du contrôle</label>
          <input id="control_${u.id}" type="date" value="${u.control_date||""}">
        </div>
        <div class="field full">
          <label>Date à faire contrôler</label>
          <input id="next_${u.id}" type="date" value="${u.next_control_date||""}">
        </div>`:""}
      </div>
    </div>`).join("");

  modal(isLaser?"Suivi des boîtes de laser":"Numéros de série",
    `<div class="muted" style="margin-bottom:10px">${esc(item.name)} · ${units.length} exemplaire(s)</div>${rows||'<div class="empty">Aucun exemplaire.</div>'}`,
    `<button class="btn btn-light" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="saveUnits('${id}')">Enregistrer</button>`
  );
}

async function saveUnits(itemId){
  const item=getItem(itemId);if(!item)return;
  const units=unitsFor(itemId);
  try{
    for(const u of units){
      const patch={serial_number:($(`#serial_${u.id}`)?.value||"").trim()};
      if(item.requires_laser_control){
        patch.control_date=$(`#control_${u.id}`)?.value||null;
        patch.next_control_date=$(`#next_${u.id}`)?.value||null;
      }
      const {error}=await sb.from("equipment_units").update(patch).eq("id",u.id);
      if(error)throw error;
    }
    const c=state.containers.find(x=>x.id===item.container_id);
    await addHistory("serial_update",c,item.name,units.length,item.requires_laser_control?"N° série et contrôles laser mis à jour":"N° de série mis à jour");
    closeModal();await loadAll({quiet:true});toast("Suivi matériel enregistré");
  }catch(e){toast("Erreur : "+e.message)}
}

async function addHistory(type,c,itemName="",qty=0,note=""){const{error}=await sb.from("history").insert({container_id:c?.id||null,actor_name:session.name||"Administrateur",event_type:type,item_name:itemName,qty,note});if(error)throw error}
function openCount(id){const i=getItem(id);modal("Compter le matériel",`<div class="form-grid"><div class="field full"><label>Matériel</label><input value="${esc(i.name)}" disabled></div><div class="field"><label>Prévu</label><input value="${i.expected}" disabled></div><div class="field"><label>Réparation</label><input value="${i.repair}" disabled></div><div class="field full"><label>Quantité présente</label><input id="countPresent" type="number" min="0" value="${i.present}"></div></div>`,`<button class="btn btn-light" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="saveCount('${id}')">Enregistrer</button>`)}
async function saveCount(id){const i=getItem(id),c=state.containers.find(x=>x.id===i.container_id),present=Math.max(0,+$("#countPresent").value||0);const{error}=await sb.from("container_items").update({present}).eq("id",id);if(error){toast("Erreur : "+error.message);return}await addHistory("count",c,i.name,present,"");closeModal();await loadAll({quiet:true});toast("Comptage enregistré")}
function openRepair(id){const i=getItem(id);modal("Envoyer en réparation",`<div class="form-grid"><div class="field full"><label>Matériel</label><input value="${esc(i.name)}" disabled></div><div class="field"><label>Présent</label><input value="${i.present}" disabled></div><div class="field"><label>Quantité à envoyer</label><input id="repairQty" type="number" min="1" max="${Math.max(i.present,1)}" value="1"></div><div class="field full"><label>Remarque</label><textarea id="repairNote" placeholder="Panne, atelier, commentaire..."></textarea></div></div>`,`<button class="btn btn-light" onclick="closeModal()">Annuler</button><button class="btn btn-danger" onclick="saveRepair('${id}')">Envoyer</button>`)}
async function saveRepair(id){const i=getItem(id),c=state.containers.find(x=>x.id===i.container_id);let q=Math.max(1,+$("#repairQty").value||1);q=Math.min(q,+i.present);if(i.present<=0){toast("Aucun exemplaire présent.");return}const{error}=await sb.from("container_items").update({present:i.present-q,repair:i.repair+q}).eq("id",id);if(error){toast("Erreur : "+error.message);return}await addHistory("repair",c,i.name,q,$("#repairNote").value.trim());closeModal();await loadAll({quiet:true});toast("Envoyé en réparation")}
function openReturn(id){const i=getItem(id);modal("Retour de réparation",`<div class="form-grid"><div class="field full"><label>Matériel</label><input value="${esc(i.name)}" disabled></div><div class="field"><label>En réparation</label><input value="${i.repair}" disabled></div><div class="field"><label>Quantité de retour</label><input id="returnQty" type="number" min="1" max="${i.repair}" value="1"></div><div class="field full"><label>Remarque</label><textarea id="returnNote"></textarea></div></div>`,`<button class="btn btn-light" onclick="closeModal()">Annuler</button><button class="btn btn-success" onclick="saveReturn('${id}')">Valider le retour</button>`)}
async function saveReturn(id){const i=getItem(id),c=state.containers.find(x=>x.id===i.container_id);let q=Math.max(1,+$("#returnQty").value||1);q=Math.min(q,+i.repair);const{error}=await sb.from("container_items").update({present:i.present+q,repair:i.repair-q}).eq("id",id);if(error){toast("Erreur : "+error.message);return}await addHistory("return",c,i.name,q,$("#returnNote").value.trim());closeModal();await loadAll({quiet:true});toast("Retour enregistré")}
function openItemAdd(){const c=currentContainer();if(!c)return;modal("Ajouter un matériel",`<div class="form-grid"><div class="field full"><label>Nom</label><input id="itemName" placeholder="Ex. Scie circulaire"></div><div class="field"><label>Quantité prévue</label><input id="itemExpected" type="number" min="0" value="1"></div><div class="field"><label>Quantité présente</label><input id="itemPresent" type="number" min="0" value="1"></div><div class="field full"><label><input id="itemSerial" type="checkbox" style="width:auto"> Suivre le numéro de série</label></div><div class="field full"><label><input id="itemLaser" type="checkbox" style="width:auto"> Matériel laser : ajouter dates de contrôle</label></div></div><div class="muted" style="margin-top:10px">Ce matériel sera ajouté uniquement à ${esc(c.name)}.</div>`,`<button class="btn btn-light" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="saveItemAdd()">Ajouter</button>`)}
async function saveItemAdd(){const c=currentContainer(),name=$("#itemName").value.trim(),expected=Math.max(0,+$("#itemExpected").value||0),present=Math.max(0,+$("#itemPresent").value||0),laser=!!$("#itemLaser").checked,serial=!!$("#itemSerial").checked||laser;if(!name){toast("Indique un nom.");return}const{data,error}=await sb.from("container_items").insert({container_id:c.id,catalog_id:null,name,expected,present,repair:0,requires_serial:serial,requires_laser_control:laser}).select().single();if(error){toast("Erreur : "+error.message);return}if(serial){const rows=[];for(let n=1;n<=Math.max(expected,1);n++)rows.push({container_item_id:data.id,unit_no:n});const r=await sb.from("equipment_units").insert(rows);if(r.error){toast("Matériel ajouté, mais erreur unités : "+r.error.message);return}}await addHistory("item_add",c,name,expected,"Ajout propre à ce container");closeModal();await loadAll({quiet:true});toast("Matériel ajouté")}
function openItemEdit(id){const i=getItem(id);modal("Modifier / supprimer",`<div class="form-grid"><div class="field full"><label>Nom</label><input id="editName" value="${esc(i.name)}"></div><div class="field"><label>Prévu</label><input id="editExpected" type="number" min="0" value="${i.expected}"></div><div class="field"><label>Présent</label><input id="editPresent" type="number" min="0" value="${i.present}"></div><div class="field full"><label>En réparation</label><input id="editRepair" type="number" min="0" value="${i.repair}"></div><div class="field full"><label><input id="editSerial" type="checkbox" style="width:auto" ${i.requires_serial?"checked":""}> Suivre le numéro de série</label></div><div class="field full"><label><input id="editLaser" type="checkbox" style="width:auto" ${i.requires_laser_control?"checked":""}> Matériel laser : dates de contrôle</label></div></div>`,`<button class="btn btn-danger" onclick="deleteItem('${id}')">🗑 Supprimer</button><button class="btn btn-light" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="saveItemEdit('${id}')">Enregistrer</button>`)}
async function saveItemEdit(id){const i=getItem(id),c=state.containers.find(x=>x.id===i.container_id),laser=!!$("#editLaser").checked,serial=!!$("#editSerial").checked||laser,patch={name:$("#editName").value.trim()||i.name,expected:Math.max(0,+$("#editExpected").value||0),present:Math.max(0,+$("#editPresent").value||0),repair:Math.max(0,+$("#editRepair").value||0),requires_serial:serial,requires_laser_control:laser};const{error}=await sb.from("container_items").update(patch).eq("id",id);if(error){toast("Erreur : "+error.message);return}if(serial){await loadAll({quiet:true});await ensureUnits(getItem(id));}await addHistory("item_edit",c,patch.name,patch.expected,"");closeModal();await loadAll({quiet:true});toast("Matériel modifié")}
async function deleteItem(id){const i=getItem(id),c=state.containers.find(x=>x.id===i.container_id);if(!confirm(`Supprimer « ${i.name} » uniquement de ${c.name} ?`))return;const{error}=await sb.from("container_items").delete().eq("id",id);if(error){toast("Erreur : "+error.message);return}await addHistory("item_delete",c,i.name,0,"");closeModal();await loadAll({quiet:true});toast("Matériel supprimé")}
async function validateInventory(){const c=currentContainer();if(!c)return;const d=now();const{error}=await sb.from("containers").update({last_inventory:d}).eq("id",c.id);if(error){toast("Erreur : "+error.message);return}await addHistory("inventory",c,"",0,"");await loadAll({quiet:true});toast("Inventaire validé")}
function openContainerMeta(){const c=currentContainer();modal("Modifier le container",`<div class="form-grid"><div class="field full"><label>Nom / numéro</label><input id="contName" value="${esc(c.name)}"></div><div class="field full"><label>Localisation / chantier</label><input id="contLoc" value="${esc(c.location||"")}"></div></div>`,`<button class="btn btn-light" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="saveContainerMeta()">Enregistrer</button>`)}
async function saveContainerMeta(){const c=currentContainer(),patch={name:$("#contName").value.trim()||c.name,location:$("#contLoc").value.trim()};const{error}=await sb.from("containers").update(patch).eq("id",c.id);if(error){toast("Erreur : "+error.message);return}closeModal();await loadAll({quiet:true});toast("Container mis à jour")}

async function init(){
  if(!configured()){
    $("#setupNotice").classList.remove("hidden");
    $("#setupNotice").textContent="Configuration Supabase manquante : ajoute ta clé sb_publishable_... dans config.js.";
    $("#nameGrid").innerHTML='<div class="empty" style="grid-column:1/-1">Connexion non configurée.</div>';
    return;
  }
  try{
    sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{params:{eventsPerSecond:10}}});
    await loadAll();
    subscribeRealtime();
    clearInterval(refreshTimer);
    refreshTimer=setInterval(()=>{if(document.visibilityState==="visible"&&!$("#modalRoot").children.length)loadAll({quiet:true})},Number(cfg.REFRESH_INTERVAL_MS||10000));
  }catch(err){
    console.error(err);$("#setupNotice").classList.remove("hidden");$("#setupNotice").textContent="Impossible de démarrer Supabase : "+(err.message||err);
  }
}
window.addEventListener("online",()=>loadAll({quiet:true}));
window.addEventListener("offline",()=>setSync(false,"Hors connexion"));
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&sb)loadAll({quiet:true})});
init();
