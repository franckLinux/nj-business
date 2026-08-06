// =====================================================================
// CaissePro v2 — Frontend SPA complet
// Journaux dynamiques · Budget&Réalisations · Appel de Fonds · Config 3 onglets
// =====================================================================
'use strict';

const API  = '/api';
const MOIS = ['Janvier','Fevrier','Mars','Avril','Mai','Juin',
              'Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];

const TYPES_ICONS = {
  caisse:'💵', banque:'🏦', om:'🟠', momo:'🟡', carte_prepayee:'💳', autre:'📒'
};

// ── STATE ─────────────────────────────────────────────────────────────────
const state = {
  token:           null,
  user:            null,
  activeTenantId:  null,
  activeTenantNom: null,
  rubriques:       { entrees:[], depenses:[] },
  journaux:        [],      // liste des journaux du tenant
  journalActif:    null,    // journal sélectionné { id, nom, type, code }
  currentPage:     'dashboard',
  mois:            MOIS[new Date().getMonth()],
  annee:           new Date().getFullYear(),
  editingMouvement:null,
};

// ── HELPERS ───────────────────────────────────────────────────────────────
const $   = id => document.getElementById(id);
const fmt = (n, devise) => (parseFloat(n)||0).toLocaleString('fr-FR') + ' ' + (devise||'FCFA');
const toast = (msg, type='', duration=3400) => {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast'+(type?' '+type:'');
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>{ t.style.display='none'; }, duration);
};

// ── API ───────────────────────────────────────────────────────────────────
const headers = () => {
  const tid = state.activeTenantId || state.user?.tenantId;
  return {
    'Content-Type':'application/json',
    ...(state.token ? {'Authorization':`Bearer ${state.token}`} : {}),
    ...(tid         ? {'X-Tenant-Id': tid} : {}),
  };
};
const api = {
  get:    url       => fetch(API+url,{headers:headers()}).then(r=>r.json()),
  post:   (url,b)   => fetch(API+url,{method:'POST',  headers:headers(),body:JSON.stringify(b)}).then(r=>r.json()),
  put:    (url,b)   => fetch(API+url,{method:'PUT',   headers:headers(),body:JSON.stringify(b)}).then(r=>r.json()),
  patch:  (url,b)   => fetch(API+url,{method:'PATCH', headers:headers(),body:JSON.stringify(b)}).then(r=>r.json()),
  delete: url       => fetch(API+url,{method:'DELETE',headers:headers()}).then(r=>r.json()),
};

// ── AUTH ──────────────────────────────────────────────────────────────────
const saveSession = (t,u) => { state.token=t; state.user=u; localStorage.setItem('caisse_token',t); localStorage.setItem('caisse_user',JSON.stringify(u)); };
const clearSession= () => { state.token=null; state.user=null; localStorage.removeItem('caisse_token'); localStorage.removeItem('caisse_user'); };
const loadSession = () => { const t=localStorage.getItem('caisse_token'),u=localStorage.getItem('caisse_user'); if(t&&u){state.token=t;state.user=JSON.parse(u);return true;} return false; };

// ── NAVIGATION ────────────────────────────────────────────────────────────
const showScreen = id => {
  ['screen-login','screen-app'].forEach(s => $(s).style.display = s===id?(s==='screen-app'?'flex':'block'):'none');
};

const showPage = async (pageId, opts = {}) => {
  // opts.customTitle : titre alternatif (ex: 'Suivi budgétaire' pointe vers la page 'budget')
  // opts.sourceElement : élément nav cliqué (pour préserver l'activation exacte)
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const pg = $(`page-${pageId}`); if(pg) pg.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));

  if(opts.sourceElement){
    opts.sourceElement.classList.add('active');
  } else {
    // Activation par défaut : premier nav-item avec ce data-page SANS data-title
    // (sinon "Suivi budgétaire" et "Budget" s'activeraient tous les deux pour data-page="budget")
    const def = document.querySelector(`.nav-item[data-page="${pageId}"]:not([data-title])`);
    if(def) def.classList.add('active');
  }

  // Auto-expand des groupes parents si le nav-item actif est imbriqué
  const activeNav = document.querySelector('.nav-item.active');
  if(activeNav){
    let parent = activeNav.parentElement;
    while(parent && parent !== document.body){
      if(parent.classList.contains('nav-group')) parent.classList.add('open');
      parent = parent.parentElement;
    }
  }

  const titles = {
    'dashboard':'Tableau de bord','journal':'Journal de caisse',
    'journal-view':'Journal — Détail',
    'journaux-recap':'Journaux de caisse',
    'budget':'Suivi Budgétaire','previsions':'Prévisions de dépenses',
    'appel-fonds':'Demande de fonds',
    'compte-emploi':"Compte d'emploi",'config':'Configuration','tenants':'Clients (Tenants)',
    'permissions':'Gestion des permissions',
    'attente':'Dépenses en attente',
  };
  $('page-title').textContent = opts.customTitle || titles[pageId] || pageId;
  state.currentPage = pageId;
  if(typeof updateNotifBadge==='function') updateNotifBadge();
  if(['directeur','super_admin'].includes(state.user?.role) && typeof updateAttenteBadge==='function') updateAttenteBadge();

  if(pageId==='dashboard')    await loadDashboard();
  if(pageId==='journal')      await loadJournalPage();
  if(pageId==='journal-view') await loadJournalView();
  if(pageId==='journaux-recap') await loadJournauxRecap();
  if(pageId==='budget')         await loadBudget();
  if(pageId==='previsions')     await loadPrevisions();
  if(pageId==='appel-fonds')    await loadAppelFonds();
  if(pageId==='compte-emploi')  await loadCompteEmploi();
  if(pageId==='config')         await loadConfig();
  if(pageId==='tenants')        await loadTenants();
  if(pageId==='permissions')    await loadPermissions();
  if(pageId==='attente')        await loadMouvementsAttentePage();
};

// ── Toggle d'un groupe collapsible de la sidebar ─────────────────────────
window.toggleNavGroup = (groupName) => {
  const el = $(`nav-group-${groupName}`);
  if(!el) return;
  el.classList.toggle('open');
  const isOpen = el.classList.contains('open');
  try {
    const saved = JSON.parse(localStorage.getItem('navGroupState') || '{}');
    saved[groupName] = isOpen;
    localStorage.setItem('navGroupState', JSON.stringify(saved));
  } catch(_){}
};

// ── Restauration de l'état au démarrage ──────────────────────────────────
const restoreNavGroupState = () => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('navGroupState') || '{}'); } catch(_){}
  document.querySelectorAll('.nav-group').forEach(group => {
    const id = group.id.replace('nav-group-', '');
    const defaultOpen = group.dataset.defaultOpen === 'true';
    const shouldOpen = (saved[id] !== undefined) ? saved[id] : defaultOpen;
    if(shouldOpen) group.classList.add('open');
  });
};

// ── PÉRIODE ───────────────────────────────────────────────────────────────
const initPeriod = () => {
  const sm=$('sel-mois'), sa=$('sel-annee');
  MOIS.forEach(m=>{ const o=document.createElement('option'); o.value=m; o.textContent=m; sm.appendChild(o); });
  sm.value = state.mois;
  const yr=new Date().getFullYear();
  for(let y=yr;y>=yr-5;y--){ const o=document.createElement('option'); o.value=y; o.textContent=y; sa.appendChild(o); }
  sa.value = state.annee;
  sm.addEventListener('change', async ()=>{ state.mois=sm.value; await showPage(state.currentPage); });
  sa.addEventListener('change', async ()=>{ state.annee=parseInt(sa.value); await showPage(state.currentPage); });
};

// ── JOURNAUX (sidebar dynamique) ──────────────────────────────────────────
const loadJournaux = async () => {
  const data = await api.get('/journaux');
  if(data.error) return;
  state.journaux = data.journaux || [];
  renderSidebarJournaux(data.grouped || {});
};

const renderSidebarJournaux = (grouped) => {
  const container = $('nav-journaux-section');
  if(!container) return;

  // Aplanir la liste, ordre : caisse → banque → om → momo → carte → autre
  const TYPE_ORDER = ['caisse','banque','om','momo','carte_prepayee','autre'];
  const all = [];
  TYPE_ORDER.forEach(type => {
    (grouped[type] || []).filter(j => j.actif).forEach(j => all.push(j));
  });

  if(all.length === 0){
    container.innerHTML = `<div class="sidebar-empty-journaux">Aucun journal — voir Configuration</div>`;
    return;
  }

  container.innerHTML = all.map(j => `
    <a href="#" class="nav-item nav-sub" data-page="journal" data-journal-id="${j.id}"
       title="${(j.nom||'').replace(/"/g,'&quot;')}"
       onclick="event.preventDefault();selectJournal(${j.id})">
      <span class="j-badge">${j.code}</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${j.nom}</span>
    </a>`).join('');
};

window.selectJournal = async (journalId) => {
  const j = state.journaux.find(x=>x.id===journalId);
  if(!j) return;
  state.journalActif = j;
  $('page-title').textContent = `${j.nom} (${j.code})`;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const link = document.querySelector(`[data-journal-id="${journalId}"]`);
  if(link){
    link.classList.add('active');
    // Auto-expand des groupes parents (Saisie + Traitements)
    let parent = link.parentElement;
    while(parent && parent !== document.body){
      if(parent.classList.contains('nav-group')) parent.classList.add('open');
      parent = parent.parentElement;
    }
  }
  state.currentPage = 'journal';
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  $('page-journal')?.classList.add('active');
  await loadJournalPage();
};

// ── RUBRIQUES ─────────────────────────────────────────────────────────────
const loadRubriques = async () => {
  const data = await api.get('/rubriques');
  if(data.entrees){ state.rubriques=data; try{ await SyncManager.cacheRubriques(data); }catch(_){} }
  else if(!navigator.onLine){ try{ const c=await SyncManager.getCachedRubriques(); if(c.entrees.length>0)state.rubriques=c; }catch(_){} }
};

// ── DASHBOARD ─────────────────────────────────────────────────────────────
let fluxChart=null, pieChart=null;
const loadDashboard = async () => {
  const container = $('dashboard-content');
  const data = await api.get(`/dashboard/stats?annee=${state.annee}`);
  if(data.error){ container.innerHTML=`<div class="alert-err">${data.error}</div>`; return; }

  const soldesHtml = (data.soldesJournaux||[]).map(j => `
    <div class="kpi-card">
      <div class="kpi-icon kpi-blue"><span style="font-size:20px">${TYPES_ICONS[j.type]||'📒'}</span></div>
      <div class="kpi-body">
        <p class="kpi-label">${j.nom}</p>
        <p class="kpi-value" style="font-size:16px">${fmt(j.solde)}</p>
      </div>
    </div>`).join('');

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-icon kpi-green">
        <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
      </div><div class="kpi-body"><p class="kpi-label">Entrées ${state.annee}</p>
        <p class="kpi-value" id="kpi-entrees">${fmt(data.totalEntrees)}</p></div></div>
      <div class="kpi-card"><div class="kpi-icon kpi-red">
        <svg viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
      </div><div class="kpi-body"><p class="kpi-label">Sorties ${state.annee}</p>
        <p class="kpi-value" id="kpi-sorties">${fmt(data.totalSorties)}</p></div></div>
      <div class="kpi-card"><div class="kpi-icon kpi-purple">
        <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/></svg>
      </div><div class="kpi-body"><p class="kpi-label">Mouvements</p>
        <p class="kpi-value">${data.nbMouvements}</p></div></div>
    </div>
    <div class="kpi-grid" style="margin-top:0">${soldesHtml}</div>
    <div class="chart-row">
      <div class="chart-card" style="flex:2">
        <h3>Flux mensuels ${state.annee}</h3>
        <canvas id="chart-flux" height="100"></canvas>
      </div>
      <div class="chart-card" style="flex:1">
        <h3>Mouvements par mois</h3>
        <canvas id="chart-pie" height="220"></canvas>
      </div>
    </div>`;

  // Graphe barres
  const entrees = new Array(12).fill(0), sorties = new Array(12).fill(0);
  (data.tendance||[]).forEach(r => {
    const idx=MOIS.indexOf(r.mois);
    if(idx>=0){ entrees[idx]+=parseFloat(r.entrees||0); sorties[idx]+=parseFloat(r.sorties||0); }
  });
  if(fluxChart) fluxChart.destroy();
  fluxChart = new Chart($('chart-flux'),{
    type:'bar',
    data:{labels:MOIS.map(m=>m.substring(0,3)),datasets:[
      {label:'Entrées', data:entrees, backgroundColor:'#86efac', borderRadius:4},
      {label:'Sorties', data:sorties, backgroundColor:'#fca5a5', borderRadius:4},
    ]},
    options:{responsive:true,plugins:{legend:{position:'top'}},
      scales:{y:{ticks:{callback:v=>(v/1000)+'k'},grid:{color:'#f1f5f9'}},x:{grid:{display:false}}}},
  });
  if(pieChart) pieChart.destroy();
  const nonZero = MOIS.map((m,i)=>({m:m.substring(0,3),v:entrees[i]+sorties[i]})).filter(x=>x.v>0);
  if(nonZero.length>0){
    pieChart = new Chart($('chart-pie'),{
      type:'doughnut',
      data:{labels:nonZero.map(x=>x.m),datasets:[{data:nonZero.map(x=>x.v),
        backgroundColor:['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16','#f43f5e','#a855f7','#14b8a6','#f97316','#6366f1'],
        borderWidth:2,borderColor:'#fff'}]},
      options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:10}}}},cutout:'60%'},
    });
  }
};

// ── JOURNAL PAGE — Vue lecture seule ──────────────────────────────────────
const loadJournalPage = async () => {
  const container = $('journal-content');
  if (!container) return;

  if (!state.journalActif) {
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
        padding:80px 40px;background:white;border:1px solid var(--border);border-radius:16px;
        box-shadow:0 1px 8px rgba(0,0,0,.05)">
        <div style="width:64px;height:64px;background:linear-gradient(135deg,#e2e8f0,#cbd5e1);
          border-radius:50%;display:flex;align-items:center;justify-content:center;
          font-size:28px;margin-bottom:16px">📒</div>
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px">Sélectionnez un journal</div>
        <div style="font-size:13px;color:#94a3b8">Cliquez sur un journal dans la barre latérale gauche.</div>
      </div>`;
    return;
  }

  // Skeleton
  container.innerHTML = `
    <div style="background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:16px;
      height:110px;margin-bottom:16px;animation:pulse 1.5s infinite"></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${[1,2,3,4].map(()=>`<div style="height:80px;background:#f1f5f9;border-radius:12px;animation:pulse 1.5s infinite"></div>`).join('')}
    </div>
    <div style="height:300px;background:#f8fafc;border-radius:14px;animation:pulse 1.5s infinite"></div>`;

  const j = state.journalActif;
  const [data, budgetData] = await Promise.all([
    api.get(`/journal?mois=${state.mois}&annee=${state.annee}&journal_id=${j.id}`),
    api.get(`/budget-caisse?journal_id=${j.id}&mois=${state.mois}&annee=${state.annee}`),
  ]);
  if (data.error) { container.innerHTML = `<div class="alert-err">${data.error}</div>`; return; }

  // Mise en cache du contexte de contrôle budgétaire (pour le pré-contrôle hors-ligne)
  if (navigator.onLine) {
    api.get(`/journal/controle-context?journal_id=${j.id}&mois=${state.mois}&annee=${state.annee}`)
      .then(ctx => { if (ctx && !ctx.error) SyncManager.cacheControleContext(ctx); })
      .catch(() => {});
  }

  const s        = data.soldes || {};
  const ranAuto  = data.ran_auto || 0;
  const soldePrev= data.solde_precedent || 0;
  const prevLabel= moisPrevLabel(state.mois, state.annee);
  const arret    = data.arret || null;
  const isArrete = !!arret;
  const mouvements = data.mouvements || [];

  // Budget caisse — données enrichies depuis le backend
  const budgetCaisse       = (budgetData && !budgetData.error) ? budgetData : null;
  const budgetMontant      = budgetCaisse ? parseFloat(budgetCaisse.montant) : 0;
  const budgetSorties      = budgetCaisse ? (parseFloat(budgetCaisse.sorties_actuelles) || (parseFloat(s.sorties)||0)) : (parseFloat(s.sorties)||0);
  const budgetTaux         = budgetCaisse?.taux_consommation ?? (budgetMontant > 0 ? Math.round((budgetSorties/budgetMontant)*100) : 0);
  const budgetRestant      = budgetCaisse?.restant ?? (budgetMontant > 0 ? budgetMontant - budgetSorties : 0);
  const budgetAlerte       = budgetCaisse?.alerte ?? (budgetMontant > 0 && budgetSorties > budgetMontant ? 'depasse' : 'ok');
  const budgetDepasse      = budgetAlerte === 'depasse';
  const budgetEnAttenteNb  = budgetCaisse?.en_attente_nb || 0;
  const budgetPct          = Math.min(budgetTaux, 100);
  const ALERTE_COLOR = { depasse:'#dc2626', critique:'#ea580c', attention:'#d97706', ok:'#7c3aed' };
  const ALERTE_BG    = { depasse:'linear-gradient(135deg,#fef2f2,#fee2e2)', critique:'linear-gradient(135deg,#fff7ed,#fed7aa)', attention:'linear-gradient(135deg,#fffbeb,#fef08a)', ok:'linear-gradient(135deg,#f5f3ff,#ede9fe)' };
  const ALERTE_BORDER= { depasse:'#fca5a5', critique:'#fdba74', attention:'#fde68a', ok:'#c4b5fd' };
  const alerteColor  = ALERTE_COLOR[budgetAlerte] || '#7c3aed';
  const alerteBg     = ALERTE_BG[budgetAlerte]    || ALERTE_BG.ok;
  const alerteBorder = ALERTE_BORDER[budgetAlerte]|| '#c4b5fd';

  // Couleurs par type
  const TYPE_COLOR = {
    caisse:'#16a34a', om:'#ea580c', momo:'#ca8a04',
    carte_prepayee:'#7c3aed', banque:'#0369a1', autre:'#64748b',
  };
  const TYPE_LABEL = {
    caisse:'Caisse Espèces', om:'Orange Money', momo:'Mobile Money',
    carte_prepayee:'Carte Prépayée', banque:'Banque', autre:'Autre',
  };
  const typeColor = TYPE_COLOR[j.type] || '#64748b';
  const soldeColor = (parseFloat(s.solde)||0) >= 0 ? '#15803d' : '#dc2626';
  const soldeBg    = (parseFloat(s.solde)||0) >= 0
    ? 'linear-gradient(135deg,#16a34a,#15803d)'
    : 'linear-gradient(135deg,#dc2626,#b91c1c)';

  // Nb entrées / sorties
  const nbE = mouvements.filter(m => parseFloat(m.entree) > 0).length;
  const nbS = mouvements.filter(m => parseFloat(m.sortie) > 0).length;

  container.innerHTML = `

    <!-- ── Hero header ────────────────────────────────────────────────── -->
    <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);
      border-radius:16px;padding:22px 26px;margin-bottom:16px;
      box-shadow:0 4px 24px rgba(15,23,42,.18);position:relative;overflow:hidden">
      <!-- Cercle déco -->
      <div style="position:absolute;top:-30px;right:-30px;width:160px;height:160px;
        border-radius:50%;background:${typeColor};opacity:.12;pointer-events:none"></div>
      <div style="position:absolute;bottom:-40px;right:60px;width:100px;height:100px;
        border-radius:50%;background:${typeColor};opacity:.08;pointer-events:none"></div>

      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="width:52px;height:52px;border-radius:14px;
            background:${typeColor};display:flex;align-items:center;justify-content:center;
            font-size:24px;box-shadow:0 2px 12px rgba(0,0,0,.2)">
            ${TYPES_ICONS[j.type]||'📒'}
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:20px;font-weight:800;color:white">${j.nom}</span>
              <span style="background:rgba(255,255,255,.15);color:rgba(255,255,255,.9);
                font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px">${j.code}</span>
              ${isArrete
                ? `<span style="background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px">🔒 Arrêtée</span>`
                : `<span style="background:rgba(251,191,36,.2);color:#fbbf24;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px">🔓 Ouverte</span>`}
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,.55)">
              ${TYPE_LABEL[j.type]||j.type}
              · ${state.mois} ${state.annee}
              ${j.responsable_saisie_nom ? `· Saisi par <strong style="color:rgba(255,255,255,.8)">${j.responsable_saisie_nom}</strong>` : ''}
            </div>
          </div>
        </div>
        <!-- Boutons d'action CRUD -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${!isArrete ? `
          <button onclick="openModalMouvement(null,${j.id})"
            style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;
              background:linear-gradient(135deg,#16a34a,#15803d);border:none;
              border-radius:9px;color:white;font-size:13px;font-weight:700;
              cursor:pointer;box-shadow:0 2px 10px rgba(22,163,74,.35);transition:all .15s"
            onmouseover="this.style.transform='translateY(-1px)'"
            onmouseout="this.style.transform=''">
            + Nouveau mouvement
          </button>` : ''}
          <button onclick="openModalRan(${j.id},${ranAuto})"
            style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;
              background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);
              border-radius:9px;color:rgba(255,255,255,.8);font-size:12px;font-weight:600;
              cursor:pointer;backdrop-filter:blur(4px)">
            📊 RAN
          </button>
          <button onclick="openModalBudgetCaisse(${j.id})"
            style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;
              background:rgba(139,92,246,.25);border:1px solid rgba(139,92,246,.4);
              border-radius:9px;color:#c4b5fd;font-size:12px;font-weight:600;
              cursor:pointer;backdrop-filter:blur(4px)">
            💰 Budget
          </button>
          ${!isArrete ? `
          <button onclick="openModalArretCaisse(${j.id},${parseFloat(s.solde)||0})"
            style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;
              background:rgba(217,119,6,.2);border:1px solid rgba(217,119,6,.4);
              border-radius:9px;color:#fbbf24;font-size:12px;font-weight:600;
              cursor:pointer;backdrop-filter:blur(4px)">
            🔒 Arrêter
          </button>` : (['directeur','super_admin'].includes(state.user?.role) ? `
          <button onclick="rouvrirCaisse(${j.id})"
            style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;
              background:rgba(239,68,68,.2);border:1px solid rgba(239,68,68,.4);
              border-radius:9px;color:#fca5a5;font-size:12px;font-weight:600;
              cursor:pointer;backdrop-filter:blur(4px)">
            🔓 Rouvrir
          </button>` : '')}
          <button onclick="loadJournalPage()"
            style="display:inline-flex;align-items:center;gap:4px;padding:8px 12px;
              background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);
              border-radius:9px;color:rgba(255,255,255,.7);font-size:12px;
              cursor:pointer;backdrop-filter:blur(4px)"
            title="Actualiser">
            ↺
          </button>
        </div>
      </div>

      <!-- Bannière arrêt si arrêtée -->
      ${isArrete ? `
      <div style="margin-top:14px;padding:10px 14px;background:rgba(134,239,172,.12);
        border:1px solid rgba(134,239,172,.3);border-radius:10px;
        font-size:12px;color:#86efac">
        🔒 Caisse arrêtée le
        <strong>${new Date(arret.arrete_le).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}</strong>
        par <strong>${arret.arrete_par_nom||'—'}</strong>
        · Solde arrêté : <strong>${fmt(parseFloat(arret.solde_final))}</strong>
        ${arret.commentaire ? `· <em>"${arret.commentaire}"</em>` : ''}
      </div>` : ''}
    </div>

    <!-- ── KPI cards ───────────────────────────────────────────────────── -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-bottom:16px">
      <!-- RAN -->
      <div style="background:white;border-radius:12px;border:1px solid var(--border);
        padding:16px 18px;box-shadow:0 1px 6px rgba(0,0,0,.05)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
          color:#92400e;margin-bottom:6px">Report à Nouveau</div>
        <div style="font-size:19px;font-weight:800;color:#78350f">${fmt(ranAuto)}</div>
        ${soldePrev > 0 ? `<div style="font-size:10px;color:#a16207;margin-top:4px">
          ↑ Solde ${prevLabel} : ${fmt(soldePrev)}</div>` : ''}
      </div>
      <!-- Entrées -->
      <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border-radius:12px;
        border:1px solid #86efac;padding:16px 18px;box-shadow:0 1px 6px rgba(22,163,74,.08)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
          color:#16a34a;margin-bottom:6px">Entrées du mois</div>
        <div style="font-size:19px;font-weight:800;color:#15803d">${fmt(s.entrees)}</div>
        <div style="font-size:10px;color:#16a34a;margin-top:4px">${nbE} opération${nbE>1?'s':''}</div>
      </div>
      <!-- Sorties -->
      <div style="background:linear-gradient(135deg,#fef2f2,#fee2e2);border-radius:12px;
        border:1px solid #fca5a5;padding:16px 18px;box-shadow:0 1px 6px rgba(220,38,38,.08)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
          color:#dc2626;margin-bottom:6px">Sorties du mois</div>
        <div style="font-size:19px;font-weight:800;color:#b91c1c">${fmt(s.sorties)}</div>
        <div style="font-size:10px;color:#dc2626;margin-top:4px">${nbS} opération${nbS>1?'s':''}</div>
      </div>
      <!-- Solde -->
      <div style="background:${soldeBg};border-radius:12px;
        padding:16px 18px;box-shadow:0 2px 12px rgba(0,0,0,.12)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
          color:rgba(255,255,255,.75);margin-bottom:6px">Solde Final</div>
        <div style="font-size:19px;font-weight:800;color:white">${fmt(s.solde)}</div>
        <div style="font-size:10px;color:rgba(255,255,255,.65);margin-top:4px">
          RAN + Entrées − Sorties
        </div>
      </div>
      <!-- Budget caisse — carte enrichie -->
      ${budgetMontant > 0 ? `
      <div style="background:${alerteBg};border-radius:12px;border:1px solid ${alerteBorder};
        padding:14px 16px;box-shadow:0 1px 6px rgba(0,0,0,.07);cursor:pointer;position:relative"
        onclick="openModalBudgetCaisse(${j.id})">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
          color:${alerteColor};margin-bottom:3px">
          ${budgetAlerte==='depasse'?'⛔ Budget dépassé':budgetAlerte==='critique'?'🔴 Critique':budgetAlerte==='attention'?'🟡 Attention':'💰 Budget dépenses'}
        </div>
        <div style="font-size:16px;font-weight:800;color:${alerteColor}">${fmt(budgetMontant)}</div>
        <div style="margin-top:7px">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:${alerteColor};margin-bottom:3px">
            <span>${budgetTaux}% consommé</span>
            <span>${budgetDepasse ? '−'+fmt(Math.abs(budgetRestant)) : fmt(budgetRestant)+' restant'}</span>
          </div>
          <div style="background:rgba(0,0,0,.08);border-radius:100px;height:7px;overflow:hidden">
            <div style="background:${alerteColor};height:100%;border-radius:100px;
              width:${budgetPct}%;min-width:4px;transition:width .4s ease"></div>
          </div>
        </div>
        ${budgetEnAttenteNb > 0 ? `
        <div style="margin-top:7px;font-size:10px;font-weight:600;
          color:#92400e;background:#fef3c7;border-radius:6px;padding:3px 7px;display:inline-block">
          ⏳ ${budgetEnAttenteNb} demande${budgetEnAttenteNb>1?'s':''} en attente
        </div>` : ''}
      </div>` : `
      <div style="background:#f5f3ff;border-radius:12px;border:2px dashed #c4b5fd;
        padding:16px 18px;cursor:pointer;text-align:center"
        onclick="openModalBudgetCaisse(${j.id})">
        <div style="font-size:20px;margin-bottom:4px">💰</div>
        <div style="font-size:11px;font-weight:700;color:#7c3aed;margin-bottom:2px">Budget non défini</div>
        <div style="font-size:10px;color:#a78bfa">Cliquez pour fixer un budget</div>
      </div>`}
    </div>

    <!-- ── Tableau des mouvements ──────────────────────────────────────── -->
    <div style="background:white;border-radius:14px;border:1px solid var(--border);
      overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,.06)">
      <!-- Titre section -->
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:14px 20px;border-bottom:1px solid var(--border);
        background:linear-gradient(90deg,#f8fafc,#fff)">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:30px;height:30px;border-radius:8px;background:${typeColor};
            display:flex;align-items:center;justify-content:center;font-size:14px">
            ${TYPES_ICONS[j.type]||'📒'}
          </div>
          <div>
            <div style="font-size:13px;font-weight:700;color:#0f172a">
              Mouvements — ${state.mois} ${state.annee}
            </div>
            <div style="font-size:11px;color:#94a3b8">
              ${mouvements.length} ligne${mouvements.length>1?'s':''}
            </div>
          </div>
        </div>
      </div>

      <!-- Table -->
      <div class="table-wrap" style="margin:0">
        <table>
          <thead>
            <tr>
              <th style="width:90px">Date</th>
              <th style="width:90px">Rubrique</th>
              <th>Intitulé</th>
              <th>Bénéficiaire</th>
              <th style="text-align:right;width:120px">Entrée</th>
              <th style="text-align:right;width:120px">Sortie</th>
              <th style="text-align:right;width:130px">Solde cumulé</th>
              <th style="width:90px;text-align:center">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${(() => {
              if (mouvements.length === 0) return `
                <tr><td colspan="8" style="text-align:center;padding:50px;color:#94a3b8">
                  <div style="font-size:32px;margin-bottom:10px">📭</div>
                  <div style="font-size:13px;font-weight:600">Aucun mouvement</div>
                  <div style="font-size:12px;margin-top:4px">Aucune opération enregistrée pour ${state.mois} ${state.annee}</div>
                </td></tr>`;
              window._journalMouvements = {};
              mouvements.forEach(m => { window._journalMouvements[m.id] = m; });
              let cumul = ranAuto;
              return mouvements.map(m => {
                const e = parseFloat(m.entree) || 0;
                const so = parseFloat(m.sortie) || 0;
                cumul += e - so;
                const cumulColor = cumul >= 0 ? '#15803d' : '#dc2626';
                return `
                <tr style="transition:background .12s"
                  onmouseover="this.style.background='#f8fafc'"
                  onmouseout="this.style.background=''">
                  <td style="color:#64748b;font-size:12px;white-space:nowrap">
                    ${new Date(m.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})}
                  </td>
                  <td>
                    <span style="background:#f1f5f9;color:#475569;font-size:10px;font-weight:700;
                      padding:2px 7px;border-radius:5px;white-space:nowrap">${m.rubrique_code}</span>
                  </td>
                  <td>
                    <div style="font-size:13px;font-weight:500;color:#0f172a">${m.intitule}</div>
                    ${m.objet ? `<div style="font-size:11px;color:#94a3b8">${m.objet}</div>` : ''}
                  </td>
                  <td style="font-size:12px;color:#64748b">${m.beneficiaire || '—'}</td>
                  <td style="text-align:right;font-weight:700;color:#16a34a;font-size:13px">
                    ${e > 0 ? fmt(e) : ''}
                  </td>
                  <td style="text-align:right;font-weight:700;color:#dc2626;font-size:13px">
                    ${so > 0 ? fmt(so) : ''}
                  </td>
                  <td style="text-align:right;font-weight:800;font-size:13px;color:${cumulColor}">
                    ${fmt(cumul)}
                  </td>
                  <td style="text-align:center;white-space:nowrap">
                    ${!isArrete ? `
                    <button onclick="event.stopPropagation();openModalMouvement(window._journalMouvements[${m.id}],${j.id})"
                      title="Modifier"
                      style="padding:4px 8px;background:#f0f9ff;border:1px solid #bae6fd;
                        border-radius:6px;cursor:pointer;font-size:12px;color:#0369a1;
                        transition:all .12s;margin-right:3px"
                      onmouseover="this.style.background='#e0f2fe'"
                      onmouseout="this.style.background='#f0f9ff'">✏️</button>
                    <button onclick="event.stopPropagation();deleteMouvement(${m.id})"
                      title="Supprimer"
                      style="padding:4px 8px;background:#fef2f2;border:1px solid #fecaca;
                        border-radius:6px;cursor:pointer;font-size:12px;color:#dc2626;
                        transition:all .12s"
                      onmouseover="this.style.background='#fee2e2'"
                      onmouseout="this.style.background='#fef2f2'">✕</button>` : '<span style="color:#94a3b8;font-size:11px">—</span>'}
                  </td>
                </tr>`;
              }).join('');
            })()}
          </tbody>
          ${mouvements.length > 0 ? `
          <tfoot>
            <tr style="background:linear-gradient(90deg,#0f172a,#1e293b);color:white;font-weight:800">
              <td colspan="4" style="color:rgba(255,255,255,.7);font-size:12px">TOTAL DU MOIS</td>
              <td style="text-align:right;color:#86efac;font-size:14px">${fmt(s.entrees)}</td>
              <td style="text-align:right;color:#fca5a5;font-size:14px">${fmt(s.sorties)}</td>
              <td style="text-align:right;color:white;font-size:15px">${fmt(s.solde)}</td>
              <td></td>
            </tr>
          </tfoot>` : ''}
        </table>
      </div>
    </div>`;
};

const moisPrevLabel = (mois,annee) => {
  const idx=MOIS.indexOf(mois);
  return idx===0?`Décembre ${annee-1}`:`${MOIS[idx-1]} ${annee}`;
};

// ── VUE JOURNAL EN LECTURE SEULE (depuis Reporting > Journaux de caisse) ──
const loadJournalView = async () => {
  const container = $('journal-view-content');
  if (!container) return;

  if (!state.journalActif) {
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
        padding:80px 40px;background:white;border:1px solid var(--border);border-radius:16px;
        box-shadow:0 1px 8px rgba(0,0,0,.05)">
        <div style="font-size:32px;margin-bottom:16px">📒</div>
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px">Sélectionnez un journal</div>
        <div style="font-size:13px;color:#94a3b8">Cliquez sur un journal dans la vue consolidée.</div>
      </div>`;
    return;
  }

  // Skeleton
  container.innerHTML = `
    <div style="background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:16px;
      height:110px;margin-bottom:16px;animation:pulse 1.5s infinite"></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${[1,2,3,4].map(()=>`<div style="height:80px;background:#f1f5f9;border-radius:12px;animation:pulse 1.5s infinite"></div>`).join('')}
    </div>
    <div style="height:300px;background:#f8fafc;border-radius:14px;animation:pulse 1.5s infinite"></div>`;

  const j = state.journalActif;
  const data = await api.get(`/journal?mois=${state.mois}&annee=${state.annee}&journal_id=${j.id}`);
  if (data.error) { container.innerHTML = `<div class="alert-err">${data.error}</div>`; return; }

  // Stocker pour l'impression
  window._journalViewState = { j, data, mois: state.mois, annee: state.annee, tenantNom: state.activeTenantNom };

  const s        = data.soldes || {};
  const ranAuto  = data.ran_auto || 0;
  const soldePrev= data.solde_precedent || 0;
  const prevLabel= moisPrevLabel(state.mois, state.annee);
  const arret    = data.arret || null;
  const isArrete = !!arret;
  const mouvements = data.mouvements || [];

  const TYPE_COLOR = { caisse:'#16a34a', om:'#ea580c', momo:'#ca8a04', carte_prepayee:'#7c3aed', banque:'#0369a1', autre:'#64748b' };
  const TYPE_LABEL = { caisse:'Caisse Espèces', om:'Orange Money', momo:'Mobile Money', carte_prepayee:'Carte Prépayée', banque:'Banque', autre:'Autre' };
  const typeColor = TYPE_COLOR[j.type] || '#64748b';
  const soldeColor = (parseFloat(s.solde)||0) >= 0 ? '#15803d' : '#dc2626';
  const soldeBg    = (parseFloat(s.solde)||0) >= 0
    ? 'linear-gradient(135deg,#16a34a,#15803d)'
    : 'linear-gradient(135deg,#dc2626,#b91c1c)';

  const nbE = mouvements.filter(m => parseFloat(m.entree) > 0).length;
  const nbS = mouvements.filter(m => parseFloat(m.sortie) > 0).length;

  container.innerHTML = `

    <!-- ── Hero header (lecture seule) ──────────────────────────────────── -->
    <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);
      border-radius:16px;padding:22px 26px;margin-bottom:16px;
      box-shadow:0 4px 24px rgba(15,23,42,.18);position:relative;overflow:hidden">
      <div style="position:absolute;top:-30px;right:-30px;width:160px;height:160px;
        border-radius:50%;background:${typeColor};opacity:.12;pointer-events:none"></div>
      <div style="position:absolute;bottom:-40px;right:60px;width:100px;height:100px;
        border-radius:50%;background:${typeColor};opacity:.08;pointer-events:none"></div>

      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="width:52px;height:52px;border-radius:14px;
            background:${typeColor};display:flex;align-items:center;justify-content:center;
            font-size:24px;box-shadow:0 2px 12px rgba(0,0,0,.2)">
            ${TYPES_ICONS[j.type]||'📒'}
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:20px;font-weight:800;color:white">${j.nom}</span>
              <span style="background:rgba(255,255,255,.15);color:rgba(255,255,255,.9);
                font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px">${j.code}</span>
              ${isArrete
                ? `<span style="background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px">🔒 Arrêtée</span>`
                : `<span style="background:rgba(251,191,36,.2);color:#fbbf24;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px">🔓 Ouverte</span>`}
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,.55)">
              ${TYPE_LABEL[j.type]||j.type}
              · ${state.mois} ${state.annee}
              ${j.responsable_saisie_nom ? `· Saisi par <strong style="color:rgba(255,255,255,.8)">${j.responsable_saisie_nom}</strong>` : ''}
            </div>
          </div>
        </div>
        <!-- Boutons lecture seule -->
        <div style="display:flex;align-items:center;gap:8px">
          <button onclick="printJournalView()"
            style="display:inline-flex;align-items:center;gap:6px;padding:9px 16px;
              background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);
              border-radius:9px;color:white;font-size:13px;font-weight:600;
              cursor:pointer;backdrop-filter:blur(4px);transition:all .15s"
            onmouseover="this.style.background='rgba(255,255,255,.25)'"
            onmouseout="this.style.background='rgba(255,255,255,.15)'">
            🖨️ Imprimer
          </button>
          <button onclick="loadJournalView()"
            style="display:inline-flex;align-items:center;gap:4px;padding:9px 12px;
              background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);
              border-radius:9px;color:rgba(255,255,255,.7);font-size:12px;
              cursor:pointer;backdrop-filter:blur(4px)"
            title="Actualiser">↺</button>
        </div>
      </div>

      ${isArrete ? `
      <div style="margin-top:14px;padding:10px 14px;background:rgba(134,239,172,.12);
        border:1px solid rgba(134,239,172,.3);border-radius:10px;
        font-size:12px;color:#86efac">
        🔒 Caisse arrêtée le
        <strong>${new Date(arret.arrete_le).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}</strong>
        par <strong>${arret.arrete_par_nom||'—'}</strong>
        · Solde arrêté : <strong>${fmt(parseFloat(arret.solde_final))}</strong>
        ${arret.commentaire ? `· <em>"${arret.commentaire}"</em>` : ''}
      </div>` : ''}
    </div>

    <!-- ── KPI cards ───────────────────────────────────────────────────── -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-bottom:16px">
      <div style="background:white;border-radius:12px;border:1px solid var(--border);
        padding:16px 18px;box-shadow:0 1px 6px rgba(0,0,0,.05)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
          color:#92400e;margin-bottom:6px">Report à Nouveau</div>
        <div style="font-size:19px;font-weight:800;color:#78350f">${fmt(ranAuto)}</div>
        ${soldePrev > 0 ? `<div style="font-size:10px;color:#a16207;margin-top:4px">
          ↑ Solde ${prevLabel} : ${fmt(soldePrev)}</div>` : ''}
      </div>
      <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border-radius:12px;
        border:1px solid #86efac;padding:16px 18px;box-shadow:0 1px 6px rgba(22,163,74,.08)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
          color:#16a34a;margin-bottom:6px">Entrées du mois</div>
        <div style="font-size:19px;font-weight:800;color:#15803d">${fmt(s.entrees)}</div>
        <div style="font-size:10px;color:#16a34a;margin-top:4px">${nbE} opération${nbE>1?'s':''}</div>
      </div>
      <div style="background:linear-gradient(135deg,#fef2f2,#fee2e2);border-radius:12px;
        border:1px solid #fca5a5;padding:16px 18px;box-shadow:0 1px 6px rgba(220,38,38,.08)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
          color:#dc2626;margin-bottom:6px">Sorties du mois</div>
        <div style="font-size:19px;font-weight:800;color:#b91c1c">${fmt(s.sorties)}</div>
        <div style="font-size:10px;color:#dc2626;margin-top:4px">${nbS} opération${nbS>1?'s':''}</div>
      </div>
      <div style="background:${soldeBg};border-radius:12px;
        padding:16px 18px;box-shadow:0 2px 12px rgba(0,0,0,.12)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
          color:rgba(255,255,255,.75);margin-bottom:6px">Solde Final</div>
        <div style="font-size:19px;font-weight:800;color:white">${fmt(s.solde)}</div>
        <div style="font-size:10px;color:rgba(255,255,255,.65);margin-top:4px">RAN + Entrées − Sorties</div>
      </div>
    </div>

    <!-- ── Tableau des mouvements (lecture seule) ──────────────────────── -->
    <div style="background:white;border-radius:14px;border:1px solid var(--border);
      overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,.06)">
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:14px 20px;border-bottom:1px solid var(--border);
        background:linear-gradient(90deg,#f8fafc,#fff)">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:30px;height:30px;border-radius:8px;background:${typeColor};
            display:flex;align-items:center;justify-content:center;font-size:14px">
            ${TYPES_ICONS[j.type]||'📒'}
          </div>
          <div>
            <div style="font-size:13px;font-weight:700;color:#0f172a">
              Mouvements — ${state.mois} ${state.annee}
            </div>
            <div style="font-size:11px;color:#94a3b8">${mouvements.length} ligne${mouvements.length>1?'s':''} · Vue lecture seule</div>
          </div>
        </div>
      </div>
      <div class="table-wrap" style="margin:0">
        <table>
          <thead>
            <tr>
              <th style="width:90px">Date</th>
              <th style="width:90px">Rubrique</th>
              <th>Intitulé</th>
              <th>Bénéficiaire</th>
              <th style="text-align:right;width:120px">Entrée</th>
              <th style="text-align:right;width:120px">Sortie</th>
              <th style="text-align:right;width:130px">Solde cumulé</th>
            </tr>
          </thead>
          <tbody>
            ${(() => {
              if (mouvements.length === 0) return `
                <tr><td colspan="7" style="text-align:center;padding:50px;color:#94a3b8">
                  <div style="font-size:32px;margin-bottom:10px">📭</div>
                  <div style="font-size:13px;font-weight:600">Aucun mouvement</div>
                  <div style="font-size:12px;margin-top:4px">Aucune opération pour ${state.mois} ${state.annee}</div>
                </td></tr>`;
              let cumul = ranAuto;
              return mouvements.map(m => {
                const e = parseFloat(m.entree) || 0;
                const so = parseFloat(m.sortie) || 0;
                cumul += e - so;
                const cumulColor = cumul >= 0 ? '#15803d' : '#dc2626';
                return `
                <tr style="transition:background .12s"
                  onmouseover="this.style.background='#f8fafc'"
                  onmouseout="this.style.background=''">
                  <td style="color:#64748b;font-size:12px;white-space:nowrap">
                    ${new Date(m.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})}
                  </td>
                  <td>
                    <span style="background:#f1f5f9;color:#475569;font-size:10px;font-weight:700;
                      padding:2px 7px;border-radius:5px;white-space:nowrap">${m.rubrique_code}</span>
                  </td>
                  <td>
                    <div style="font-size:13px;font-weight:500;color:#0f172a">${m.intitule}</div>
                    ${m.objet ? `<div style="font-size:11px;color:#94a3b8">${m.objet}</div>` : ''}
                  </td>
                  <td style="font-size:12px;color:#64748b">${m.beneficiaire || '—'}</td>
                  <td style="text-align:right;font-weight:700;color:#16a34a;font-size:13px">
                    ${e > 0 ? fmt(e) : ''}
                  </td>
                  <td style="text-align:right;font-weight:700;color:#dc2626;font-size:13px">
                    ${so > 0 ? fmt(so) : ''}
                  </td>
                  <td style="text-align:right;font-weight:800;font-size:13px;color:${cumulColor}">
                    ${fmt(cumul)}
                  </td>
                </tr>`;
              }).join('');
            })()}
          </tbody>
          ${mouvements.length > 0 ? `
          <tfoot>
            <tr style="background:linear-gradient(90deg,#0f172a,#1e293b);color:white;font-weight:800">
              <td colspan="4" style="color:rgba(255,255,255,.7);font-size:12px">TOTAL DU MOIS</td>
              <td style="text-align:right;color:#86efac;font-size:14px">${fmt(s.entrees)}</td>
              <td style="text-align:right;color:#fca5a5;font-size:14px">${fmt(s.sorties)}</td>
              <td style="text-align:right;color:white;font-size:15px">${fmt(s.solde)}</td>
            </tr>
          </tfoot>` : ''}
        </table>
      </div>
    </div>`;
};

// ── IMPRESSION JOURNAL (fenêtre dédiée A4) ───────────────────────────────
window.printJournalView = () => {
  const d = window._journalViewState;
  if (!d) { toast('Aucune donnée à imprimer.','error'); return; }
  const { j, data, mois, annee, tenantNom } = d;
  const fmtN = n => (parseFloat(n)||0).toLocaleString('fr-FR',{minimumFractionDigits:0});
  const s         = data.soldes || {};
  const ranAuto   = data.ran_auto || 0;
  const mouvements= data.mouvements || [];
  const arret     = data.arret || null;
  const isArrete  = !!arret;
  const TYPE_LABEL_P = { caisse:'Caisse Espèces', om:'Orange Money', momo:'Mobile Money', carte_prepayee:'Carte Prépayée', banque:'Banque', autre:'Autre' };
  const soldeVal  = parseFloat(s.solde) || 0;
  const nbE = mouvements.filter(m=>parseFloat(m.entree)>0).length;
  const nbS = mouvements.filter(m=>parseFloat(m.sortie)>0).length;

  let cumul = ranAuto;
  const rows = mouvements.length === 0
    ? `<tr><td colspan="7" style="text-align:center;padding:20px;color:#9ca3af;font-style:italic">Aucun mouvement pour cette période</td></tr>`
    : mouvements.map(m => {
        const e  = parseFloat(m.entree)  || 0;
        const so = parseFloat(m.sortie)  || 0;
        cumul += e - so;
        const cc = cumul >= 0 ? '#15803d' : '#b91c1c';
        return `<tr>
          <td style="color:#6b7280;white-space:nowrap">${new Date(m.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})}</td>
          <td><span style="background:#f1f5f9;border:1px solid #cbd5e1;padding:1px 5px;border-radius:3px;font-weight:700;font-size:9px;color:#475569;white-space:nowrap">${m.rubrique_code}</span></td>
          <td>${m.intitule}${m.objet?`<br><span style="font-size:9px;color:#9ca3af">${m.objet}</span>`:''}</td>
          <td style="color:#6b7280">${m.beneficiaire||'—'}</td>
          <td style="text-align:right;color:#15803d;font-weight:700">${e>0?fmtN(e):''}</td>
          <td style="text-align:right;color:#b91c1c;font-weight:700">${so>0?fmtN(so):''}</td>
          <td style="text-align:right;font-weight:800;color:${cc}">${fmtN(cumul)}</td>
        </tr>`;
      }).join('');

  const html = `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8">
<title>${j.nom} — ${mois} ${annee}</title>
<style>
  @page { size: A4 landscape; margin: 14mm 12mm 10mm; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  body{ font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#111; background:white; }

  /* En-tête du document */
  .doc-header{ display:flex; justify-content:space-between; align-items:flex-start;
    border-bottom:2px solid #1e293b; padding-bottom:10px; margin-bottom:12px; }
  .dh-left .company{ font-size:15px; font-weight:800; color:#1e293b; margin-bottom:3px; }
  .dh-left .doc-title{ font-size:12px; font-weight:700; color:#374151; }
  .dh-left .doc-sub{ font-size:10px; color:#6b7280; margin-top:2px; }
  .dh-right{ text-align:right; }
  .dh-right .period{ font-size:14px; font-weight:800; color:#1e293b; margin-bottom:4px; }
  .dh-right .print-date{ font-size:9px; color:#9ca3af; }
  .badge{ display:inline-block; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700; }
  .badge-arrete{ background:#dcfce7; color:#15803d; border:1px solid #86efac; }
  .badge-ouverte{ background:#fef9c3; color:#92400e; border:1px solid #fde68a; }

  /* Bannière arrêt */
  .arret-banner{ background:#f0fdf4; border:1px solid #86efac; border-radius:4px;
    padding:6px 10px; margin-bottom:10px; font-size:10px; color:#15803d; }

  /* KPI */
  .kpi-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:12px; }
  .kpi-box{ border:1px solid #e2e8f0; padding:8px 12px; border-radius:6px; }
  .kpi-label{ font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; color:#6b7280; margin-bottom:4px; }
  .kpi-value{ font-size:14px; font-weight:800; }
  .kpi-sub{ font-size:9px; color:#94a3b8; margin-top:2px; }
  .kpi-ran{ border-left:3px solid #f59e0b; } .kpi-ran .kpi-value{ color:#92400e; }
  .kpi-ent{ border-left:3px solid #16a34a; } .kpi-ent .kpi-value{ color:#15803d; }
  .kpi-sor{ border-left:3px solid #dc2626; } .kpi-sor .kpi-value{ color:#b91c1c; }
  .kpi-sol{ border-left:3px solid ${soldeVal>=0?'#16a34a':'#dc2626'}; }
  .kpi-sol .kpi-value{ color:${soldeVal>=0?'#15803d':'#b91c1c'}; }

  /* Section title */
  .section-title{ font-size:11px; font-weight:700; color:#374151; margin-bottom:6px;
    border-bottom:1px solid #e2e8f0; padding-bottom:4px; display:flex; justify-content:space-between; }
  .section-count{ font-weight:400; color:#9ca3af; font-size:10px; }

  /* Tableau */
  table{ width:100%; border-collapse:collapse; }
  thead th{ background:#1e293b; color:white; font-weight:700; border:1px solid #334155;
    padding:6px 8px; font-size:10px; }
  th.text-right, td.text-right{ text-align:right; }
  tbody tr:nth-child(even) td{ background:#f8fafc; }
  tbody td{ border:1px solid #e2e8f0; padding:5px 8px; font-size:10px; vertical-align:top; }
  tfoot td{ border:1px solid #475569; padding:6px 8px; font-size:11px; font-weight:800;
    background:#1e293b; color:white; }
  .tfoot-ent{ text-align:right; color:#86efac; }
  .tfoot-sor{ text-align:right; color:#fca5a5; }
  .tfoot-sol{ text-align:right; color:white; font-size:12px; }

  /* Pied */
  .doc-footer{ margin-top:14px; padding-top:8px; border-top:1px solid #e2e8f0;
    display:flex; justify-content:space-between; font-size:9px; color:#9ca3af; }

  tr{ page-break-inside:avoid; }
  thead{ display:table-header-group; }
  tfoot{ display:table-footer-group; }
</style>
</head><body>

  <div class="doc-header">
    <div class="dh-left">
      <div class="company">${tenantNom||'CaissePro'}</div>
      <div class="doc-title">Journal de caisse — ${j.nom}&nbsp;&nbsp;<span style="background:#f1f5f9;border-radius:4px;padding:1px 6px;font-size:11px;color:#475569">${j.code}</span></div>
      <div class="doc-sub">${TYPE_LABEL_P[j.type]||j.type} · ${isArrete?'Caisse arrêtée':'Caisse ouverte'}</div>
    </div>
    <div class="dh-right">
      <div class="period">${mois} ${annee}</div>
      <div style="margin-bottom:4px"><span class="badge ${isArrete?'badge-arrete':'badge-ouverte'}">${isArrete?'🔒 Arrêtée':'🔓 Ouverte'}</span></div>
      <div class="print-date">Imprimé le ${new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}</div>
    </div>
  </div>

  ${isArrete?`<div class="arret-banner">🔒 Arrêtée le ${new Date(arret.arrete_le).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})} par <strong>${arret.arrete_par_nom||'—'}</strong> · Solde arrêté : <strong>${fmtN(arret.solde_final)} FCFA</strong>${arret.commentaire?` · « ${arret.commentaire} »`:''}</div>`:''}

  <div class="kpi-grid">
    <div class="kpi-box kpi-ran">
      <div class="kpi-label">Report à Nouveau</div>
      <div class="kpi-value">${fmtN(ranAuto)}</div>
      <div class="kpi-sub">FCFA</div>
    </div>
    <div class="kpi-box kpi-ent">
      <div class="kpi-label">Entrées du mois</div>
      <div class="kpi-value">${fmtN(s.entrees)}</div>
      <div class="kpi-sub">${nbE} opération${nbE>1?'s':''}</div>
    </div>
    <div class="kpi-box kpi-sor">
      <div class="kpi-label">Sorties du mois</div>
      <div class="kpi-value">${fmtN(s.sorties)}</div>
      <div class="kpi-sub">${nbS} opération${nbS>1?'s':''}</div>
    </div>
    <div class="kpi-box kpi-sol">
      <div class="kpi-label">Solde Final</div>
      <div class="kpi-value">${fmtN(s.solde)}</div>
      <div class="kpi-sub">RAN + Entrées − Sorties</div>
    </div>
  </div>

  <div class="section-title">
    <span>Détail des mouvements — ${mois} ${annee}</span>
    <span class="section-count">${mouvements.length} ligne${mouvements.length>1?'s':''}</span>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:78px">Date</th>
        <th style="width:68px">Rubrique</th>
        <th>Intitulé / Objet</th>
        <th style="width:120px">Bénéficiaire</th>
        <th class="text-right" style="width:105px">Entrée (FCFA)</th>
        <th class="text-right" style="width:105px">Sortie (FCFA)</th>
        <th class="text-right" style="width:115px">Solde cumulé</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    ${mouvements.length>0?`
    <tfoot>
      <tr>
        <td colspan="4">TOTAL DU MOIS — ${mois} ${annee}</td>
        <td class="tfoot-ent">${fmtN(s.entrees)}</td>
        <td class="tfoot-sor">${fmtN(s.sorties)}</td>
        <td class="tfoot-sol">${fmtN(s.solde)}</td>
      </tr>
    </tfoot>`:''}
  </table>

  <div class="doc-footer">
    <span>${tenantNom||'CaissePro'} · Journal ${j.nom} (${j.code}) · ${mois} ${annee}</span>
    <span>CaissePro v2 — Document généré le ${new Date().toLocaleDateString('fr-FR')}</span>
  </div>

  <script>window.onload=()=>{ window.print(); };<\/script>
</body></html>`;

  const pw = window.open('','_blank','width=1200,height=850');
  if (!pw) { toast('Popup bloqué. Autorisez les popups pour imprimer.','error'); return; }
  pw.document.write(html);
  pw.document.close();
};

// ── IMPRESSION RÉCAP JOURNAUX (fenêtre dédiée A4) ────────────────────────
window.printJournauxRecap = () => {
  const d = window._journauxRecapState;
  if (!d) { toast('Aucune donnée à imprimer.','error'); return; }
  const { journaux, banque, mois, annee, tenantNom } = d;
  const fmtN = n => (parseFloat(n)||0).toLocaleString('fr-FR',{minimumFractionDigits:0});
  const TYPE_LABEL_P = { caisse:'Caisse Espèces', om:'Orange Money', momo:'Mobile Money', carte_prepayee:'Carte Prépayée', autre:'Autre' };
  const ICONS_P = { caisse:'💵', om:'🟠', momo:'🟡', carte_prepayee:'💳', autre:'📒' };
  const totalE = journaux.reduce((s,j)=>s+j.total_entrees,0);
  const totalS = journaux.reduce((s,j)=>s+j.total_sorties,0);
  const totalSol = journaux.reduce((s,j)=>s+j.solde_final,0);
  const totalRan = journaux.reduce((s,j)=>s+j.ran,0);

  const rows = journaux.map(j=>`
    <tr>
      <td><strong>${j.nom}</strong>&nbsp;<span style="background:#f1f5f9;border-radius:3px;padding:0 4px;font-size:9px;color:#6b7280">${j.code}</span></td>
      <td style="color:#6b7280">${TYPE_LABEL_P[j.type]||j.type}</td>
      <td style="text-align:right;color:#92400e;font-weight:700">${fmtN(j.ran)}</td>
      <td style="text-align:right;color:#15803d;font-weight:700">${fmtN(j.total_entrees)}</td>
      <td style="text-align:right;color:#b91c1c;font-weight:700">${fmtN(j.total_sorties)}</td>
      <td style="text-align:right;font-weight:800;color:${j.solde_final>=0?'#15803d':'#b91c1c'}">${fmtN(j.solde_final)}</td>
      <td style="text-align:center"><span style="padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;
        background:${j.arrete?'#dcfce7':'#fef9c3'};color:${j.arrete?'#15803d':'#92400e'}">${j.arrete?'🔒 Arrêtée':'🔓 Ouverte'}</span></td>
    </tr>`).join('');

  const banqueRow = (banque.solde_final>0||banque.fonds_recus>0) ? `
    <tr style="background:#faf5ff">
      <td><strong>🏦 Banque</strong></td>
      <td style="color:#7c3aed">Compte bancaire</td>
      <td style="text-align:right;color:#92400e;font-weight:700">${fmtN(banque.solde_initial)}</td>
      <td style="text-align:right;color:#15803d;font-weight:700">${fmtN(banque.fonds_recus)}</td>
      <td style="text-align:right;color:#b91c1c;font-weight:700">—</td>
      <td style="text-align:right;font-weight:800;color:#7c3aed">${fmtN(banque.solde_final)}</td>
      <td></td>
    </tr>` : '';

  const html = `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8">
<title>Journaux de caisse — ${mois} ${annee}</title>
<style>
  @page{ size:A4 landscape; margin:14mm 12mm 10mm; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  body{ font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#111; background:white; }
  .doc-header{ display:flex; justify-content:space-between; align-items:flex-start;
    border-bottom:2px solid #1e293b; padding-bottom:10px; margin-bottom:12px; }
  .dh-left .company{ font-size:15px; font-weight:800; color:#1e293b; margin-bottom:3px; }
  .dh-left .doc-title{ font-size:12px; font-weight:700; color:#374151; }
  .dh-right{ text-align:right; }
  .dh-right .period{ font-size:14px; font-weight:800; color:#1e293b; margin-bottom:4px; }
  .dh-right .print-date{ font-size:9px; color:#9ca3af; }
  .kpi-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:12px; }
  .kpi-box{ border:1px solid #e2e8f0; padding:8px 12px; border-radius:6px; }
  .kpi-label{ font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; color:#6b7280; margin-bottom:4px; }
  .kpi-value{ font-size:14px; font-weight:800; }
  .kpi-ent{ border-left:3px solid #16a34a; } .kpi-ent .kpi-value{ color:#15803d; }
  .kpi-sor{ border-left:3px solid #dc2626; } .kpi-sor .kpi-value{ color:#b91c1c; }
  .kpi-sol{ border-left:3px solid #0369a1; } .kpi-sol .kpi-value{ color:#0369a1; }
  .kpi-ran{ border-left:3px solid #f59e0b; } .kpi-ran .kpi-value{ color:#92400e; }
  .section-title{ font-size:11px; font-weight:700; color:#374151; margin-bottom:6px;
    border-bottom:1px solid #e2e8f0; padding-bottom:4px; }
  table{ width:100%; border-collapse:collapse; }
  thead th{ background:#1e293b; color:white; font-weight:700; border:1px solid #334155; padding:6px 8px; font-size:10px; }
  tbody td{ border:1px solid #e2e8f0; padding:6px 8px; font-size:10px; }
  tbody tr:nth-child(even) td{ background:#f8fafc; }
  tfoot td{ border:1px solid #475569; padding:7px 8px; font-size:11px; font-weight:800;
    background:#1e293b; color:white; }
  .doc-footer{ margin-top:14px; padding-top:8px; border-top:1px solid #e2e8f0;
    display:flex; justify-content:space-between; font-size:9px; color:#9ca3af; }
  tr{ page-break-inside:avoid; }
  thead{ display:table-header-group; }
  tfoot{ display:table-footer-group; }
</style>
</head><body>
  <div class="doc-header">
    <div class="dh-left">
      <div class="company">${tenantNom||'CaissePro'}</div>
      <div class="doc-title">État consolidé — Journaux de caisse</div>
      <div style="font-size:10px;color:#6b7280;margin-top:2px">${journaux.length} journal${journaux.length>1?'x':''} de caisse</div>
    </div>
    <div class="dh-right">
      <div class="period">${mois} ${annee}</div>
      <div class="print-date">Imprimé le ${new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-box kpi-ran">
      <div class="kpi-label">Total RAN</div>
      <div class="kpi-value">${fmtN(totalRan)} FCFA</div>
    </div>
    <div class="kpi-box kpi-ent">
      <div class="kpi-label">Total Entrées</div>
      <div class="kpi-value">${fmtN(totalE)} FCFA</div>
    </div>
    <div class="kpi-box kpi-sor">
      <div class="kpi-label">Total Sorties</div>
      <div class="kpi-value">${fmtN(totalS)} FCFA</div>
    </div>
    <div class="kpi-box kpi-sol">
      <div class="kpi-label">Solde Global Caisses</div>
      <div class="kpi-value">${fmtN(totalSol)} FCFA</div>
    </div>
  </div>

  <div class="section-title">Récapitulatif par journal — ${mois} ${annee}</div>
  <table>
    <thead>
      <tr>
        <th>Journal</th>
        <th>Type</th>
        <th style="text-align:right">RAN</th>
        <th style="text-align:right">Entrées (FCFA)</th>
        <th style="text-align:right">Sorties (FCFA)</th>
        <th style="text-align:right">Solde final</th>
        <th style="text-align:center">Statut</th>
      </tr>
    </thead>
    <tbody>${rows}${banqueRow}</tbody>
    <tfoot>
      <tr>
        <td colspan="2">TOTAL GÉNÉRAL</td>
        <td style="text-align:right;color:#fde68a">${fmtN(totalRan)}</td>
        <td style="text-align:right;color:#86efac">${fmtN(totalE)}</td>
        <td style="text-align:right;color:#fca5a5">${fmtN(totalS)}</td>
        <td style="text-align:right;color:#93c5fd;font-size:12px">${fmtN(totalSol+(banque.solde_final||0))}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <div class="doc-footer">
    <span>${tenantNom||'CaissePro'} · Journaux de caisse · ${mois} ${annee}</span>
    <span>CaissePro v2 — Document généré le ${new Date().toLocaleDateString('fr-FR')}</span>
  </div>
  <script>window.onload=()=>{ window.print(); };<\/script>
</body></html>`;

  const pw = window.open('','_blank','width=1200,height=850');
  if (!pw) { toast('Popup bloqué. Autorisez les popups pour imprimer.','error'); return; }
  pw.document.write(html);
  pw.document.close();
};

// ── MODAL MOUVEMENT ───────────────────────────────────────────────────────
window.openModalMouvement = (mouvement, journalId) => {
  state.editingMouvement = mouvement;
  const j = state.journaux.find(x=>x.id===journalId) || state.journalActif;
  $('modal-title').textContent = mouvement?'Modifier mouvement':'Nouveau mouvement';
  $('modal-err').style.display='none';
  $('m-date').value = mouvement?.date||new Date().toISOString().split('T')[0];
  const mType=$('m-type');
  mType.value = mouvement?(parseFloat(mouvement.entree)>0?'entree':'sortie'):'';
  fillRubriqueSelect(mType.value, mouvement?.rubrique_code);
  mType.onchange = ()=>fillRubriqueSelect(mType.value);
  $('m-intitule').value = mouvement?.intitule||'';
  $('m-code-comptable').value = mouvement?.code_comptable||'';
  $('m-nui').value      = mouvement?.nui||'';
  $('m-objet').value    = mouvement?.objet||'';
  $('m-benef').value    = mouvement?.beneficiaire||'';
  $('m-tel').value      = mouvement?.telephone||'';
  $('m-montant').value  = mouvement?(parseFloat(mouvement.entree)>0?mouvement.entree:mouvement.sortie):'';
  $('modal-mouvement').style.display='flex';
  $('m-date').focus();
};

const fillRubriqueSelect = (type, selected='') => {
  const sel=$('m-rubrique');
  sel.innerHTML='<option value="">— choisir —</option>';
  const list = type==='entree'?state.rubriques.entrees:state.rubriques.depenses;
  (list||[]).forEach(r=>{
    const o=document.createElement('option');
    o.value=r.code; o.textContent=`[${r.code}] ${r.intitule}`;
    if(r.code===selected) o.selected=true;
    sel.appendChild(o);
  });
  // Déclencher auto-remplissage si rubrique déjà sélectionnée
  if(selected) onRubriqueChange(selected, type);
  // Écouter les changements
  sel.onchange = () => onRubriqueChange(sel.value, type);
};

// ── Auto-remplissage code comptable + annotation pièces ──────────────────
const onRubriqueChange = async (rubriqueCode, type) => {
  // 1. Code comptable depuis la rubrique
  const allRubriques = [...(state.rubriques.entrees||[]),...(state.rubriques.depenses||[])];
  const rub = allRubriques.find(r => r.code === rubriqueCode);
  const inp = $('m-code-comptable');
  if (inp) inp.value = rub?.code_comptable || '';

  // 2. Auto-remplir intitulé si vide
  const intituleInp = $('m-intitule');
  if (intituleInp && !intituleInp.value && rub?.intitule) {
    intituleInp.value = rub.intitule;
  }

  // 3. Annotation pièces justificatives (sorties uniquement)
  const hint = $('m-pieces-hint');
  if (!hint) return;
  if (type !== 'sortie' || !rubriqueCode) {
    hint.style.display = 'none'; return;
  }
  const types = await api.get(`/pieces/types?rubrique_code=${rubriqueCode}`);
  if (!Array.isArray(types) || types.length === 0) {
    hint.style.display = 'none'; return;
  }
  const obligatoires = types.filter(t => t.obligatoire);
  const recommandees = types.filter(t => !t.obligatoire);
  let html = '<strong style="display:block;margin-bottom:4px">📎 Pièces pour ce type de dépense :</strong>';
  obligatoires.forEach(t => {
    html += `<span style="display:inline-block;margin:2px 4px 2px 0;padding:1px 8px;
      background:#fee2e2;color:#991b1b;border-radius:10px;font-size:11px;font-weight:600">
      🔴 ${t.intitule_piece}</span>`;
  });
  recommandees.forEach(t => {
    html += `<span style="display:inline-block;margin:2px 4px 2px 0;padding:1px 8px;
      background:#fef3c7;color:#92400e;border-radius:10px;font-size:11px">
      🟡 ${t.intitule_piece}</span>`;
  });
  hint.innerHTML = html;
  hint.style.display = 'block';
};

// ── Gestion fichiers joints (avant upload serveur) ────────────────────────
const _fichiersPending = []; // [{file, preview, name}]

window.ajouterFichier = (input) => {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Fichier trop lourd (max 5 Mo).','error'); return; }
  const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
  if (!allowed.includes(file.type)) { toast('Format non supporté.','error'); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    const id = _fichiersPending.length;
    _fichiersPending.push({ file, data: e.target.result, name: file.name, type: file.type });

    const preview = $('m-fichiers-preview');
    if (!preview) return;
    const isPDF = file.type === 'application/pdf';
    const div = document.createElement('div');
    div.id = `fp-${id}`;
    div.style.cssText = `position:relative;display:inline-flex;align-items:center;gap:6px;
      padding:5px 10px;background:#f0fdf4;border:1px solid #86efac;border-radius:7px;font-size:12px`;
    div.innerHTML = `
      <span>${isPDF ? '📄' : '🖼️'}</span>
      <span style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${file.name}</span>
      <button onclick="retirerFichier(${id})" style="background:none;border:none;cursor:pointer;
        color:#991b1b;font-size:14px;line-height:1;padding:0 2px">✕</button>`;
    preview.appendChild(div);
  };
  reader.readAsDataURL(file);
  input.value = ''; // reset input
};

window.retirerFichier = (id) => {
  _fichiersPending.splice(id, 1);
  const el = $(`fp-${id}`); if (el) el.remove();
};

// Upload effectif après sauvegarde du mouvement
const uploadFichiersForMouvement = async (mouvementId) => {
  for (const f of _fichiersPending) {
    const base64 = f.data.split(',')[1];
    await api.post(`/pieces/upload/${mouvementId}`, {
      nom_fichier: f.name,
      mime_type:   f.type,
      data_base64: base64,
    });
  }
  _fichiersPending.length = 0; // vider
};

const closeModal = () => {
  $('modal-mouvement').style.display='none';
  state.editingMouvement=null;
  _fichiersPending.length=0;
  const prev=$('m-fichiers-preview'); if(prev) prev.innerHTML='';
  const hint=$('m-pieces-hint'); if(hint){hint.style.display='none';hint.innerHTML='';}
};

const saveMouvement = async () => {
  const type=   $('m-type').value;
  const rubrique=$('m-rubrique').value;
  const intitule=$('m-intitule').value.trim();
  const montant=parseFloat($('m-montant').value)||0;
  const errEl=  $('modal-err');
  if(!type||!rubrique||!intitule||montant<=0){
    errEl.textContent='Champs obligatoires manquants.'; errEl.style.display='block'; return;
  }
  const j = state.journalActif;
  const body = {
    date:$('m-date').value, mois:state.mois, annee:state.annee,
    journal_id: j?.id||null,
    type_caisse: j?.type==='om'?'om':j?.type==='momo'?'om':'especes',
    rubrique_code:rubrique, intitule,
    code_comptable: $('m-code-comptable')?.value || '',
    nui:           $('m-nui')?.value || '',
    objet:$('m-objet').value, beneficiaire:$('m-benef').value, telephone:$('m-tel').value,
    entree:type==='entree'?montant:0, sortie:type==='sortie'?montant:0,
  };
  let res;
  if(!navigator.onLine&&!state.editingMouvement){
    // Pré-contrôle budgétaire local (RG-03/RG-06/RG-04) sur données mises en cache
    let verdict = { bloque:false, connu:false };
    try { verdict = await SyncManager.controleBudgetLocal(body); } catch(_){}

    const localId = await SyncManager.cacheJournalEntry({
      ...body, id:null, type_caisse:body.type_caisse,
      pre_bloque: verdict.bloque, motif_local: verdict.motif||null,
    });
    const tid=state.activeTenantId||state.user?.tenantId;
    await SyncManager.enqueue({method:'POST',url:'/api/journal',body, local_id:localId,
      headers:{'Authorization':`Bearer ${state.token}`,...(tid?{'X-Tenant-Id':tid}:{})}});
    closeModal();
    if(verdict.bloque){
      toast(`⚠ Dépassement détecté (contrôle local) : ${verdict.message} La sortie sera soumise au directeur à la synchronisation.`,'warning',9000);
    } else if(!verdict.connu){
      toast('💾 Sauvegardé hors ligne — contrôle budgétaire différé à la synchronisation.','',6000);
    } else {
      toast('💾 Sauvegardé hors ligne','');
    }
    await loadJournalPage(); return;
  }
  if(state.editingMouvement) res=await api.put(`/journal/${state.editingMouvement.id}`,body);
  else res=await api.post('/journal',body);

  // ── Modification refusée (dépassement / mois non validé sur édition) ────
  if(res.refus_modification){
    errEl.textContent=res.message; errEl.style.display='block';
    toast(`⚠ ${res.message}`,'error',7000);
    return;
  }

  // ── Sortie refusée & mise en attente (RG-03 / RG-06 / RG-04) ──────────────
  if(res.en_attente){
    closeModal();
    toast(`⏳ ${res.message}`, 'warning', 8000);
    await loadJournalPage();
    return;
  }

  // ── (Ancien flux inline plafond — conservé par compatibilité) ────────────
  if(res.require_validation){
    closeModal();
    openModalDemandeDepassement({ ...body, ...res });
    return;
  }

  // ── Alerte budget (80–100%) — enregistré mais avertissement ──────────────
  if(res.budget_warning){
    const w = res.budget_warning;
    const isUrgent = w.taux >= 95;
    const couleur  = isUrgent ? '#dc2626' : '#d97706';
    const icone    = isUrgent ? '🔴' : '🟡';
    toast(`${icone} ${w.message}`, isUrgent ? 'error' : 'warning', 6000);
  }

  if(res.error){errEl.textContent=res.error;errEl.style.display='block';return;}
  // Upload pièces jointes si présentes
  if(_fichiersPending.length > 0 && res.id) {
    try { await uploadFichiersForMouvement(res.id); } catch(e) { console.warn('Upload PJ:',e); }
  }
  closeModal();
  toast(state.editingMouvement?'Mouvement modifié ✓':'Mouvement enregistré ✓','success');
  await loadJournalPage();
};

window.deleteMouvement = async (id) => {
  if(!confirm('Supprimer ce mouvement ?')) return;
  const res=await api.delete(`/journal/${id}`);
  if(res.error){toast(res.error,'error');return;}
  toast('Supprimé.','success'); await loadJournalPage();
};

// ── MODAL RAN ─────────────────────────────────────────────────────────────
window.openModalRan = async (journalId, currentRan) => {
  // Ouvrir d'abord avec un spinner pendant le chargement du solde précédent
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-ran" onclick="if(event.target===this)closeModalRan()">
      <div class="modal-box" style="max-width:440px">
        <div class="modal-head">
          <h3>📊 Report à Nouveau</h3>
          <button class="modal-close" onclick="closeModalRan()">✕</button>
        </div>
        <div class="modal-body">

          <!-- Carte solde précédent (chargement dynamique) -->
          <div id="ran-prev-card" style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:12px;
            padding:14px 16px;margin-bottom:20px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <span style="font-size:16px">🔄</span>
              <span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#15803d">
                Solde du mois précédent
              </span>
            </div>
            <div id="ran-prev-loading" style="display:flex;align-items:center;gap:8px;color:#6b7280;font-size:13px">
              <div class="spinner" style="width:14px;height:14px;border-width:2px"></div>
              Calcul en cours…
            </div>
            <div id="ran-prev-content" style="display:none">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
                <div>
                  <div id="ran-prev-label" style="font-size:12px;color:#166534;margin-bottom:3px"></div>
                  <div id="ran-prev-amount" style="font-size:22px;font-weight:800;color:#15803d"></div>
                </div>
                <button id="ran-apply-btn" onclick="applyPrevSolde()"
                  style="display:flex;align-items:center;gap:6px;padding:9px 16px;
                    background:#15803d;color:white;border:none;border-radius:9px;
                    cursor:pointer;font-size:13px;font-weight:700;white-space:nowrap;
                    box-shadow:0 2px 8px rgba(21,128,61,.25);transition:all .15s"
                  onmouseover="this.style.background='#166534';this.style.transform='translateY(-1px)'"
                  onmouseout="this.style.background='#15803d';this.style.transform=''">
                  ↓ Appliquer ce solde
                </button>
              </div>
            </div>
            <div id="ran-prev-zero" style="display:none;font-size:13px;color:#6b7280;font-style:italic">
              Aucun mouvement sur le mois précédent (solde = 0).
            </div>
          </div>

          <!-- Séparateur -->
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
            <div style="flex:1;height:1px;background:var(--border)"></div>
            <span style="font-size:11px;color:var(--text-muted);font-weight:600">OU SAISIR MANUELLEMENT</span>
            <div style="flex:1;height:1px;background:var(--border)"></div>
          </div>

          <!-- Saisie manuelle -->
          <div class="form-section">
            <label>Montant RAN <span style="font-size:11px;color:var(--text-muted);font-weight:400">(FCFA)</span></label>
            <div style="position:relative">
              <input id="ran-montant" type="number" value="${currentRan}" min="0" step="500"
                style="padding-right:52px;font-size:15px;font-weight:700;color:#78350f;
                  background:#fffbeb;border-color:#fde68a"
                onfocus="this.style.borderColor='var(--accent)';this.style.boxShadow='0 0 0 3px rgba(59,130,246,.12)';this.style.background='white'"
                onblur="this.style.borderColor='#fde68a';this.style.boxShadow='none';this.style.background='#fffbeb'"/>
              <span style="position:absolute;right:12px;top:50%;transform:translateY(-50%);
                font-size:11px;font-weight:700;color:var(--text-muted);pointer-events:none">FCFA</span>
            </div>
          </div>

          <div id="ran-err" class="alert-err" style="display:none;margin-top:8px"></div>
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalRan()">Annuler</button>
          <button class="btn-primary" style="width:auto;margin-top:0" onclick="saveRan(${journalId})">
            💾 Enregistrer
          </button>
        </div>
      </div>
    </div>`);

  // Charger le solde du mois précédent en arrière-plan
  try {
    const j = state.journaux.find(x => x.id === journalId);
    const caisse = j?.type === 'om' || j?.type === 'momo' ? 'om' : 'especes';
    const data = await api.get(
      `/journal/ran?mois=${state.mois}&annee=${state.annee}&journal_id=${journalId}&caisse=${caisse}`
    );

    const loading = document.getElementById('ran-prev-loading');
    const content = document.getElementById('ran-prev-content');
    const zeroMsg = document.getElementById('ran-prev-zero');
    const label   = document.getElementById('ran-prev-label');
    const amount  = document.getElementById('ran-prev-amount');

    if (!loading) return; // modal fermé entre-temps

    loading.style.display = 'none';

    if (!data.error && typeof data.solde_precedent === 'number') {
      // Stocker le solde précédent pour le bouton "Appliquer"
      window._ranPrevSolde = data.solde_precedent;

      if (data.solde_precedent === 0) {
        zeroMsg.style.display = 'block';
        document.getElementById('ran-apply-btn') && (document.getElementById('ran-apply-btn').style.display = 'none');
      } else {
        label.textContent  = `Solde de ${data.mois_precedent} ${data.annee_precedente}`;
        amount.textContent = fmt(data.solde_precedent);
        content.style.display = 'block';
      }
    } else {
      zeroMsg.textContent = 'Impossible de calculer le solde précédent.';
      zeroMsg.style.display = 'block';
    }
  } catch(_) {
    const loading = document.getElementById('ran-prev-loading');
    if (loading) loading.textContent = 'Erreur de chargement.';
  }
};

window.applyPrevSolde = () => {
  const inp = document.getElementById('ran-montant');
  if (inp && typeof window._ranPrevSolde === 'number') {
    inp.value = window._ranPrevSolde;
    inp.focus();
    // Flash visuel pour signaler l'application
    inp.style.borderColor = '#15803d';
    inp.style.boxShadow   = '0 0 0 3px rgba(21,128,61,.2)';
    inp.style.background  = '#f0fdf4';
    setTimeout(() => {
      inp.style.borderColor = '#fde68a';
      inp.style.boxShadow   = 'none';
      inp.style.background  = '#fffbeb';
    }, 1200);
    toast(`Solde de ${fmt(window._ranPrevSolde)} appliqué.`, 'success');
  }
};

window.closeModalRan = () => {
  document.getElementById('modal-ran')?.remove();
  window._ranPrevSolde = null;
};

window.saveRan = async (journalId) => {
  const montant = parseFloat(document.getElementById('ran-montant')?.value);
  const errEl   = document.getElementById('ran-err');
  if (isNaN(montant) || montant < 0) {
    if (errEl) { errEl.textContent = 'Montant invalide.'; errEl.style.display = 'block'; }
    return;
  }
  const j = state.journaux.find(x => x.id === journalId);
  const caisse = j?.type === 'om' || j?.type === 'momo' ? 'om' : 'especes';
  const res = await api.post('/journal/ran', {
    mois: state.mois, annee: state.annee, caisse, montant, journal_id: journalId,
  });
  if (res.error) {
    if (errEl) { errEl.textContent = res.error; errEl.style.display = 'block'; }
    return;
  }
  closeModalRan();
  toast('RAN mis à jour ✓', 'success');
  await loadJournalPage();
};

// ── ARRÊT DE CAISSE ───────────────────────────────────────────────────────
window.openModalArretCaisse = (journalId, soldeFinal) => {
  const j = state.journalActif;
  const soldeFinalNum = parseFloat(soldeFinal) || 0;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-arret" onclick="if(event.target===this)closeModalArret()">
      <div class="modal-box" style="max-width:480px">
        <div class="modal-head" style="background:linear-gradient(135deg,#d97706,#b45309)">
          <h3 style="color:white">🔒 Arrêt de caisse</h3>
          <button class="modal-close" onclick="closeModalArret()" style="color:white;opacity:.8">✕</button>
        </div>
        <div class="modal-body">

          <!-- Récap journal -->
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;margin-bottom:20px">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#92400e;margin-bottom:8px">
              Récapitulatif — ${j?.nom || ''} · ${state.mois} ${state.annee}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div style="text-align:center;padding:10px;background:white;border-radius:8px;border:1px solid #fde68a">
                <div style="font-size:11px;color:#92400e;font-weight:600;margin-bottom:4px">SOLDE FINAL</div>
                <div style="font-size:18px;font-weight:800;color:${soldeFinalNum>=0?'#15803d':'#dc2626'}">
                  ${fmt(Math.abs(soldeFinalNum))}
                </div>
                ${soldeFinalNum < 0 ? '<div style="font-size:10px;color:#dc2626;font-weight:600">⚠️ Solde négatif</div>' : ''}
              </div>
              <div style="text-align:center;padding:10px;background:white;border-radius:8px;border:1px solid #fde68a">
                <div style="font-size:11px;color:#92400e;font-weight:600;margin-bottom:4px">DATE D'ARRÊT</div>
                <div style="font-size:14px;font-weight:700;color:#78350f">
                  ${new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}
                </div>
                <div style="font-size:11px;color:#a16207">${new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
              </div>
            </div>
          </div>

          <!-- Commentaire optionnel -->
          <div class="form-section">
            <label>Commentaire <span style="font-size:11px;color:var(--text-muted);font-weight:400">(optionnel)</span></label>
            <input type="text" id="arret-commentaire" maxlength="300"
              placeholder="Ex: Arrêt de fin de mois, caisse vérifiée et conforme…"/>
          </div>

          <!-- Avertissement -->
          <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;
            display:flex;gap:8px;align-items:flex-start;margin-top:4px">
            <span style="font-size:16px;flex-shrink:0">⚠️</span>
            <p style="font-size:12px;color:#92400e;margin:0;line-height:1.5">
              L'arrêt <strong>bloque l'ajout de nouveaux mouvements</strong> pour ce mois.
              Seul le directeur pourra rouvrir la caisse.
            </p>
          </div>
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalArret()">Annuler</button>
          <button id="arret-save-btn" onclick="confirmerArret(${journalId},${soldeFinalNum})"
            style="display:flex;align-items:center;gap:8px;padding:10px 22px;
              background:linear-gradient(135deg,#d97706,#b45309);color:white;border:none;
              border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;
              box-shadow:0 2px 8px rgba(217,119,6,.3)">
            🔒 Confirmer l'arrêt
          </button>
        </div>
      </div>
    </div>`);
  setTimeout(() => document.getElementById('arret-commentaire')?.focus(), 80);
};

window.closeModalArret = () => document.getElementById('modal-arret')?.remove();

window.confirmerArret = async (journalId, soldeFinal) => {
  const commentaire = document.getElementById('arret-commentaire')?.value.trim() || '';
  const btn = document.getElementById('arret-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Arrêt en cours…'; }
  const res = await api.post(`/journaux/${journalId}/arreter`, {
    mois: state.mois, annee: state.annee, solde_final: soldeFinal, commentaire,
  });
  if (res.error) {
    toast(res.error, 'error');
    if (btn) { btn.disabled = false; btn.textContent = "🔒 Confirmer l'arrêt"; }
    return;
  }
  toast(`Caisse arrêtée pour ${state.mois} ${state.annee} ✓`, 'success');
  closeModalArret();
  await loadJournalPage();
};

window.rouvrirCaisse = async (journalId) => {
  if (!confirm(`Rouvrir la caisse pour ${state.mois} ${state.annee} ?\nLes mouvements redeviendront éditables.`)) return;
  const res = await api.delete(`/journaux/${journalId}/arreter?mois=${state.mois}&annee=${state.annee}`);
  if (res.error) { toast(res.error, 'error'); return; }
  toast('Caisse réouverte.', 'success');
  await loadJournalPage();
};

// ── MODAL BUDGET CAISSE ───────────────────────────────────────────────────
window.openModalBudgetCaisse = async (journalId) => {
  const j = state.journaux.find(x => x.id === journalId) || state.journalActif;
  const nomJ = j ? j.nom : 'Journal';

  // Charger budget existant
  const existing = await api.get(`/budget-caisse?journal_id=${journalId}&mois=${state.mois}&annee=${state.annee}`);
  const currentMontant = (existing && !existing.error) ? parseFloat(existing.montant) || 0 : 0;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-budget-caisse" onclick="if(event.target===this)closeModalBudgetCaisse()">
      <div class="modal-box" style="max-width:420px">
        <div class="modal-head">
          <h3>💰 Budget de dépenses</h3>
          <button class="modal-close" onclick="closeModalBudgetCaisse()">✕</button>
        </div>
        <div class="modal-body">
          <div style="background:#f5f3ff;border-radius:10px;padding:12px 16px;margin-bottom:18px;
            font-size:13px;color:#5b21b6">
            <strong>${nomJ}</strong> · ${state.mois} ${state.annee}
          </div>
          <div class="form-section">
            <label>Montant du budget mensuel <span style="color:#94a3b8;font-size:11px">(optionnel)</span></label>
            <input type="number" id="bc-montant" min="0" step="1000"
              placeholder="Ex : 500000"
              value="${currentMontant > 0 ? currentMontant : ''}"/>
            <small style="color:#94a3b8;font-size:11px;margin-top:4px;display:block">
              Si défini, toute sortie dépassant ce montant nécessitera la validation du directeur.
            </small>
          </div>
          ${currentMontant > 0 ? `
          <div style="margin-top:10px">
            <button onclick="supprimerBudgetCaisse(${journalId})"
              style="background:none;border:none;color:#dc2626;font-size:12px;cursor:pointer;
                text-decoration:underline;padding:0">
              Supprimer le budget
            </button>
          </div>` : ''}
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalBudgetCaisse()">Annuler</button>
          <button onclick="sauvegarderBudgetCaisse(${journalId})"
            style="padding:10px 22px;background:linear-gradient(135deg,#7c3aed,#5b21b6);
              color:white;border:none;border-radius:9px;cursor:pointer;font-size:13px;font-weight:700">
            💾 Enregistrer
          </button>
        </div>
      </div>
    </div>`);
  setTimeout(() => document.getElementById('bc-montant')?.focus(), 60);
};

window.closeModalBudgetCaisse = () => document.getElementById('modal-budget-caisse')?.remove();

window.sauvegarderBudgetCaisse = async (journalId) => {
  const montant = parseFloat(document.getElementById('bc-montant')?.value) || 0;
  const res = await api.put('/budget-caisse', {
    journal_id: journalId, mois: state.mois, annee: state.annee, montant,
  });
  if (res.error) { toast(res.error, 'error'); return; }
  toast(`Budget ${fmt(montant)} enregistré pour ${state.mois} ${state.annee} ✓`, 'success');
  closeModalBudgetCaisse();
  await loadJournalPage();
};

window.supprimerBudgetCaisse = async (journalId) => {
  if (!confirm('Supprimer le budget de ce journal pour ce mois ?')) return;
  await api.delete(`/budget-caisse?journal_id=${journalId}&mois=${state.mois}&annee=${state.annee}`);
  toast('Budget supprimé.', 'success');
  closeModalBudgetCaisse();
  await loadJournalPage();
};

// ── MODAL DEMANDE DE DÉPASSEMENT ──────────────────────────────────────────
window.openModalDemandeDepassement = (data) => {
  const fmtN = n => (parseFloat(n)||0).toLocaleString('fr-FR',{minimumFractionDigits:0});
  const j = state.journalActif;
  const isRubrique = data.type_depassement === 'rubrique';

  // Contexte selon le type de dépassement
  const contexte = isRubrique
    ? `La dotation budgétaire de la rubrique <strong>${data.rubrique_code}</strong>
       (suivi budgétaire) sera dépassée par cette sortie de
       <strong>${fmtN(data.sortie||0)} FCFA</strong>.`
    : `Cette sortie de <strong>${fmtN(data.sortie||0)} FCFA</strong>
       dépasse le plafond mensuel du journal <strong>${j?.nom||'—'}</strong>.`;

  const labelBudget  = isRubrique ? `Dotation ${data.rubrique_code}` : 'Budget journal';
  const labelDejaDep = isRubrique ? 'Dépensé (rubrique)' : 'Dépensé (journal)';

  // Stocker les données dans un attribut JSON pour éviter l'injection HTML
  const dataKey = `_depData_${Date.now()}`;
  window[dataKey] = data;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-depassement" onclick="if(event.target===this)closeModalDepassement()">
      <div class="modal-box" style="max-width:520px">
        <div class="modal-head" style="background:linear-gradient(135deg,#7f1d1d,#991b1b);border-radius:14px 14px 0 0">
          <h3 style="color:white">⛔ Dépassement ${isRubrique ? 'budgétaire (rubrique)' : 'du budget journal'}</h3>
          <button class="modal-close" style="color:white" onclick="closeModalDepassement()">✕</button>
        </div>
        <div class="modal-body">

          <!-- Bandeau contextuel -->
          <div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:0 8px 8px 0;
            padding:12px 16px;margin-bottom:18px;font-size:13px;color:#991b1b;line-height:1.5">
            ${contexte}
          </div>

          <!-- KPIs budget -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
            <div style="background:#eff6ff;border-radius:10px;border:1px solid #bfdbfe;padding:12px;text-align:center">
              <div style="font-size:9px;color:#1d4ed8;font-weight:700;text-transform:uppercase;margin-bottom:4px;letter-spacing:.5px">${labelBudget}</div>
              <div style="font-size:14px;font-weight:800;color:#1e3a8a">${fmtN(data.budget_montant)}<span style="font-size:9px;font-weight:400"> FCFA</span></div>
            </div>
            <div style="background:#fffbeb;border-radius:10px;border:1px solid #fde68a;padding:12px;text-align:center">
              <div style="font-size:9px;color:#d97706;font-weight:700;text-transform:uppercase;margin-bottom:4px;letter-spacing:.5px">${labelDejaDep}</div>
              <div style="font-size:14px;font-weight:800;color:#92400e">${fmtN(data.sorties_actuelles)}<span style="font-size:9px;font-weight:400"> FCFA</span></div>
            </div>
            <div style="background:#fef2f2;border-radius:10px;border:1px solid #fecaca;padding:12px;text-align:center">
              <div style="font-size:9px;color:#dc2626;font-weight:700;text-transform:uppercase;margin-bottom:4px;letter-spacing:.5px">Dépassement</div>
              <div style="font-size:14px;font-weight:800;color:#b91c1c">+${fmtN(data.depassement)}<span style="font-size:9px;font-weight:400"> FCFA</span></div>
            </div>
          </div>

          <!-- Barre de dépassement -->
          <div style="margin-bottom:18px">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-bottom:4px">
              <span>Taux de consommation après cette sortie</span>
              <span style="font-weight:700;color:#dc2626">${data.taux != null ? data.taux+'%' : '> 100%'}</span>
            </div>
            <div style="background:#e2e8f0;border-radius:100px;height:8px;overflow:hidden">
              <div style="background:linear-gradient(90deg,#16a34a,#d97706,#dc2626);height:100%;width:100%;border-radius:100px"></div>
            </div>
          </div>

          <!-- Détail de la dépense -->
          <div style="background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;
            padding:12px 16px;font-size:12px;margin-bottom:16px">
            <div style="font-weight:700;color:#0f172a;margin-bottom:8px">Dépense à soumettre :</div>
            <div style="color:#475569;display:grid;grid-template-columns:auto 1fr;gap:4px 12px">
              <span style="color:#94a3b8">Intitulé</span><strong>${data.intitule||'—'}</strong>
              <span style="color:#94a3b8">Bénéficiaire</span><span>${data.beneficiaire||'—'}</span>
              <span style="color:#94a3b8">Montant</span><strong style="color:#dc2626">${fmtN(data.sortie||0)} FCFA</strong>
              ${isRubrique ? `<span style="color:#94a3b8">Source</span><span>Suivi budgétaire</span>` : ''}
            </div>
          </div>

          <p style="font-size:11px;color:#94a3b8;margin:0;text-align:center">
            Un e-mail sera envoyé au directeur. La dépense ne sera enregistrée <strong>qu'après approbation</strong>.
          </p>
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalDepassement()">Annuler</button>
          <button id="btn-envoyer-demande" onclick="envoyerDemandeDepassement('${dataKey}')"
            style="padding:10px 22px;background:linear-gradient(135deg,#dc2626,#991b1b);
              color:white;border:none;border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;
              box-shadow:0 2px 12px rgba(185,28,28,.35)">
            📤 Soumettre au directeur
          </button>
        </div>
      </div>
    </div>`);
};

window.closeModalDepassement = () => document.getElementById('modal-depassement')?.remove();

window.envoyerDemandeDepassement = async (dataKey) => {
  const data = window[dataKey];
  if (!data) { toast('Erreur : données introuvables.', 'error'); return; }

  const btn = document.getElementById('btn-envoyer-demande');
  if (btn) { btn.disabled = true; btn.textContent = 'Envoi en cours…'; }

  const j = state.journalActif;
  const res = await api.post('/budget-caisse/demande', {
    journal_id:        j?.id,
    mois:              state.mois,
    annee:             state.annee,
    date_mvt:          data.date,
    rubrique_code:     data.rubrique_code,
    intitule:          data.intitule,
    objet:             data.objet,
    beneficiaire:      data.beneficiaire,
    piece_identite:    data.piece_identite,
    telephone:         data.telephone,
    sortie:            data.sortie,
    budget_montant:    data.budget_montant,
    sorties_actuelles: data.sorties_actuelles,
    depassement:       data.depassement,
    type_depassement:  data.type_depassement || 'journal',
  });

  // Nettoyage de la clé temporaire
  delete window[dataKey];

  if (res.error) {
    toast(res.error === 'Une demande identique est déjà en attente de validation.'
      ? '⏳ Une demande pour ce paiement est déjà en attente chez le directeur.'
      : res.error, 'error', 6000);
    if (btn) { btn.disabled = false; btn.textContent = '📤 Soumettre au directeur'; }
    return;
  }
  closeModalDepassement();
  toast(
    res.email_sent
      ? '✅ Demande envoyée au directeur par e-mail — en attente de validation.'
      : '✅ Demande enregistrée. Informez le directeur (e-mail non configuré).',
    'success', 6000
  );
};

// ── DÉPASSEMENTS DE BUDGET (section embarquée dans Suivi budgétaire) ───────
window.refreshDepassementsBudget = async () => {
  const container = document.getElementById('dep-list-in-budget');
  if (!container) return;

  // Mise à jour badge nav
  const countRes = await api.get('/budget-caisse/depassements/count');
  if (!countRes.error) updateDepassementsBadge(countRes.count);

  const statut = window._depFilter || 'en_attente';

  // Filtres
  container.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      ${['en_attente','approuve','rejete','all'].map(s => `
      <button onclick="window._depFilter='${s}';refreshDepassementsBudget()"
        style="padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;
          border:2px solid ${s===statut?'#dc2626':'#e2e8f0'};
          background:${s===statut?'#fef2f2':'white'};
          color:${s===statut?'#b91c1c':'#475569'}">
        ${s==='en_attente'?'⏳ En attente':s==='approuve'?'✅ Approuvées':s==='rejete'?'❌ Rejetées':'📋 Toutes'}
      </button>`).join('')}
    </div>
    <div id="dep-rows-in-budget">
      <div style="text-align:center;padding:40px;color:#94a3b8">Chargement…</div>
    </div>`;

  const rows = await api.get(`/budget-caisse/depassements?statut=${statut}`);
  const listEl = document.getElementById('dep-rows-in-budget');
  if (!listEl) return;

  if (rows.error || !Array.isArray(rows) || rows.length === 0) {
    listEl.innerHTML = `
      <div style="background:white;border:1px solid var(--border);border-radius:14px;
        padding:48px;text-align:center">
        <div style="font-size:36px;margin-bottom:10px">✅</div>
        <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:4px">
          Aucune demande ${statut==='en_attente'?'en attente':'dans cette catégorie'}
        </div>
        <div style="font-size:12px;color:#94a3b8">Toutes les demandes ont été traitées.</div>
      </div>`;
    return;
  }

  const fmtN = n => (parseFloat(n)||0).toLocaleString('fr-FR',{minimumFractionDigits:0});
  const STATUT_BADGE = {
    en_attente: `<span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;
      padding:3px 8px;border-radius:6px">⏳ En attente</span>`,
    approuve: `<span style="background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;
      padding:3px 8px;border-radius:6px">✅ Approuvé</span>`,
    rejete: `<span style="background:#fef2f2;color:#dc2626;font-size:11px;font-weight:700;
      padding:3px 8px;border-radius:6px">❌ Rejeté</span>`,
  };

  listEl.innerHTML = rows.map(d => `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;
      margin-bottom:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)">
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:13px 18px;border-bottom:1px solid #f1f5f9;
        background:linear-gradient(90deg,#fef2f2 0%,#fff 60%)">
        <div style="display:flex;align-items:center;gap:11px">
          <div style="width:36px;height:36px;border-radius:10px;background:#fee2e2;
            display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0">⚠️</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:#0f172a">${d.intitule}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">
              ${d.journal_nom||'—'} · ${d.mois} ${d.annee}
              · Par <strong>${d.demandeur_nom||'—'}</strong>
              le ${new Date(d.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})}
            </div>
          </div>
        </div>
        ${STATUT_BADGE[d.statut]||''}
      </div>
      <div style="padding:14px 18px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:12px">
          <div style="background:#eff6ff;border-radius:8px;padding:9px 11px">
            <div style="font-size:10px;color:#1d4ed8;font-weight:600;text-transform:uppercase;margin-bottom:1px">Budget mensuel</div>
            <div style="font-size:13px;font-weight:800;color:#1e3a8a">${fmtN(d.budget_montant)} FCFA</div>
          </div>
          <div style="background:#fffbeb;border-radius:8px;padding:9px 11px">
            <div style="font-size:10px;color:#d97706;font-weight:600;text-transform:uppercase;margin-bottom:1px">Déjà dépensé</div>
            <div style="font-size:13px;font-weight:800;color:#92400e">${fmtN(d.sorties_actuelles)} FCFA</div>
          </div>
          <div style="background:#fef2f2;border-radius:8px;padding:9px 11px">
            <div style="font-size:10px;color:#dc2626;font-weight:600;text-transform:uppercase;margin-bottom:1px">Montant sortie</div>
            <div style="font-size:13px;font-weight:800;color:#b91c1c">${fmtN(d.sortie)} FCFA</div>
          </div>
          <div style="background:#fdf4ff;border-radius:8px;padding:9px 11px">
            <div style="font-size:10px;color:#7c3aed;font-weight:600;text-transform:uppercase;margin-bottom:1px">Dépassement</div>
            <div style="font-size:13px;font-weight:800;color:#5b21b6">${fmtN(d.depassement)} FCFA</div>
          </div>
        </div>
        <div style="font-size:12px;color:#475569;margin-bottom:${d.statut==='en_attente'?'12px':'0'}">
          Bénéficiaire : <strong>${d.beneficiaire||'—'}</strong>
          ${d.objet ? ` · Objet : ${d.objet}` : ''}
          ${d.commentaire_dir ? `<br>Commentaire : <em style="color:#64748b">"${d.commentaire_dir}"</em>` : ''}
          ${d.valide_par ? `<br>Traité par <strong>${d.valideur_nom||'—'}</strong>
            le ${new Date(d.valide_le).toLocaleDateString('fr-FR')}` : ''}
        </div>
        ${d.statut === 'en_attente' ? `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <input type="text" id="comment-${d.id}" placeholder="Commentaire optionnel"
            style="flex:1;min-width:140px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;
              font-size:12px;box-sizing:border-box"/>
          <button onclick="validerDepassement(${d.id},'approuve')"
            style="padding:8px 18px;background:linear-gradient(135deg,#16a34a,#15803d);
              color:white;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;
              box-shadow:0 2px 8px rgba(21,128,61,.3)">
            ✅ Approuver
          </button>
          <button onclick="validerDepassement(${d.id},'rejete')"
            style="padding:8px 18px;background:linear-gradient(135deg,#dc2626,#b91c1c);
              color:white;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;
              box-shadow:0 2px 8px rgba(185,28,28,.3)">
            ❌ Rejeter
          </button>
        </div>` : ''}
      </div>
    </div>`).join('');
};

window.validerDepassement = async (demandeId, statut) => {
  const commentaire = document.getElementById(`comment-${demandeId}`)?.value.trim() || '';
  const label = statut === 'approuve' ? 'Approuver' : 'Rejeter';
  if (!confirm(`${label} cette demande de dépassement ?`)) return;

  const res = await api.patch(`/budget-caisse/demande/${demandeId}/statut`, { statut, commentaire });
  if (res.error) { toast(res.error, 'error'); return; }
  toast(res.message || 'Traitement effectué ✓', 'success');
  await refreshDepassementsBudget();
};

const updateDepassementsBadge = (count) => {
  const badge = $('depassements-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
};

// ── JOURNAUX DE CAISSE — VUE CONSOLIDÉE ──────────────────────────────────
const loadJournauxRecap = async () => {
  const container = $('journaux-recap-content');
  if (!container) return;

  if (!state.activeTenantId && state.user?.role !== 'super_admin') {
    container.innerHTML = `<div style="text-align:center;padding:60px;background:white;border:1px solid var(--border);border-radius:12px;">
      <div style="font-size:40px;margin-bottom:12px">📒</div>
      <h3 style="font-size:16px;font-weight:700;margin-bottom:8px">Sélectionnez un client</h3>
      <p style="color:var(--text-muted);font-size:13px">Choisissez un client dans la barre du haut.</p>
    </div>`;
    return;
  }

  // Skeleton pendant le chargement
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:20px">
      ${[1,2,3].map(()=>`
        <div style="background:white;border-radius:14px;border:1px solid var(--border);padding:20px;box-shadow:0 1px 6px rgba(0,0,0,.05)">
          <div style="height:14px;background:#f1f5f9;border-radius:6px;width:60%;margin-bottom:12px"></div>
          <div style="height:10px;background:#f8fafc;border-radius:4px;width:80%;margin-bottom:8px"></div>
          <div style="height:10px;background:#f8fafc;border-radius:4px;width:50%"></div>
        </div>`).join('')}
    </div>`;

  const data = await api.get(`/journal/recap?mois=${state.mois}&annee=${state.annee}`);
  if (data.error) {
    container.innerHTML = `<div class="alert-err">${data.error}</div>`;
    return;
  }

  const { journaux, banque } = data;
  // Stocker pour l'impression
  window._journauxRecapState = { journaux, banque, mois: state.mois, annee: state.annee, tenantNom: state.activeTenantNom };

  const ICONS = { caisse:'💵', om:'🟠', momo:'🟡', carte_prepayee:'💳', autre:'📒' };
  const TYPE_LABEL = { caisse:'Caisse Espèces', om:'Orange Money', momo:'Mobile Money', carte_prepayee:'Carte Prépayée', autre:'Autre' };
  const TYPE_COLOR = { caisse:'#16a34a', om:'#ea580c', momo:'#ca8a04', carte_prepayee:'#7c3aed', autre:'#64748b' };

  const totalEntrees = journaux.reduce((s,j)=>s+j.total_entrees,0);
  const totalSorties = journaux.reduce((s,j)=>s+j.total_sorties,0);
  const totalSolde   = journaux.reduce((s,j)=>s+j.solde_final,0);
  const totalRan     = journaux.reduce((s,j)=>s+j.ran,0);

  const soldeColor = n => n >= 0 ? '#15803d' : '#dc2626';
  const soldeBg    = n => n >= 0 ? '#f0fdf4' : '#fef2f2';

  // ── KPI globaux ──────────────────────────────────────────────────────────
  const kpiHtml = `
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:20px">
    <div style="background:linear-gradient(135deg,#16a34a,#15803d);color:white;border-radius:14px;padding:18px 20px;box-shadow:0 2px 12px rgba(22,163,74,.25)">
      <div style="font-size:11px;font-weight:700;opacity:.85;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">Total Entrées</div>
      <div style="font-size:20px;font-weight:800">${fmt(totalEntrees)}</div>
      <div style="font-size:10px;opacity:.7;margin-top:4px">${journaux.length} journal${journaux.length>1?'x':''}</div>
    </div>
    <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);color:white;border-radius:14px;padding:18px 20px;box-shadow:0 2px 12px rgba(220,38,38,.25)">
      <div style="font-size:11px;font-weight:700;opacity:.85;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">Total Sorties</div>
      <div style="font-size:20px;font-weight:800">${fmt(totalSorties)}</div>
    </div>
    <div style="background:linear-gradient(135deg,#0369a1,#075985);color:white;border-radius:14px;padding:18px 20px;box-shadow:0 2px 12px rgba(3,105,161,.25)">
      <div style="font-size:11px;font-weight:700;opacity:.85;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">Solde Global Caisses</div>
      <div style="font-size:20px;font-weight:800">${fmt(totalSolde)}</div>
      <div style="font-size:10px;opacity:.7;margin-top:4px">RAN : ${fmt(totalRan)}</div>
    </div>
    ${banque.solde_final > 0 || banque.fonds_recus > 0 ? `
    <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;border-radius:14px;padding:18px 20px;box-shadow:0 2px 12px rgba(124,58,237,.25)">
      <div style="font-size:11px;font-weight:700;opacity:.85;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">🏦 Banque</div>
      <div style="font-size:20px;font-weight:800">${fmt(banque.solde_final)}</div>
      <div style="font-size:10px;opacity:.7;margin-top:4px">Reçu ce mois : ${fmt(banque.fonds_recus)}</div>
    </div>` : ''}
  </div>`;

  // ── Cartes par journal ───────────────────────────────────────────────────
  const cardsHtml = journaux.length === 0
    ? `<div style="text-align:center;padding:50px;background:white;border-radius:14px;border:1px solid var(--border);color:var(--text-muted);font-size:13px">
        Aucun journal de caisse configuré pour cette période.
       </div>`
    : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:20px">
        ${journaux.map(j => {
          const color = TYPE_COLOR[j.type] || '#64748b';
          const isArrete = !!j.arrete;
          return `
          <div onclick="navigateToJournal(${j.id})"
            style="background:white;border-radius:14px;border:1px solid var(--border);
              overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.05);cursor:pointer;
              transition:all .18s;position:relative"
            onmouseover="this.style.boxShadow='0 4px 18px rgba(0,0,0,.12)';this.style.transform='translateY(-2px)'"
            onmouseout="this.style.boxShadow='0 1px 6px rgba(0,0,0,.05)';this.style.transform=''">
            <!-- Bandeau couleur type -->
            <div style="height:4px;background:${color}"></div>
            <div style="padding:16px 18px">
              <!-- En-tête journal -->
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
                <div style="display:flex;align-items:center;gap:10px">
                  <span style="font-size:26px;line-height:1">${ICONS[j.type]||'📒'}</span>
                  <div>
                    <div style="font-size:14px;font-weight:700;color:#0f172a">${j.nom}</div>
                    <div style="font-size:11px;color:${color};font-weight:600">${TYPE_LABEL[j.type]||j.type}</div>
                  </div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
                  <span style="background:#f1f5f9;color:#64748b;font-size:10px;font-weight:700;
                    padding:2px 7px;border-radius:6px">${j.code}</span>
                  ${isArrete ? `<span style="background:#dcfce7;color:#15803d;font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px">🔒 Arrêtée</span>` : ''}
                </div>
              </div>
              <!-- Stats -->
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
                <div style="background:#f0fdf4;border-radius:8px;padding:8px 10px">
                  <div style="font-size:10px;color:#16a34a;font-weight:700;text-transform:uppercase;margin-bottom:2px">Entrées</div>
                  <div style="font-size:14px;font-weight:800;color:#15803d">${fmt(j.total_entrees)}</div>
                </div>
                <div style="background:#fef2f2;border-radius:8px;padding:8px 10px">
                  <div style="font-size:10px;color:#dc2626;font-weight:700;text-transform:uppercase;margin-bottom:2px">Sorties</div>
                  <div style="font-size:14px;font-weight:800;color:#b91c1c">${fmt(j.total_sorties)}</div>
                </div>
              </div>
              <!-- RAN + Solde -->
              <div style="display:flex;align-items:center;justify-content:space-between;
                background:${soldeBg(j.solde_final)};border-radius:8px;padding:8px 12px">
                <div style="font-size:11px;color:#64748b">
                  RAN : <strong>${fmt(j.ran)}</strong>
                </div>
                <div style="text-align:right">
                  <div style="font-size:10px;color:${soldeColor(j.solde_final)};font-weight:700;text-transform:uppercase">Solde</div>
                  <div style="font-size:16px;font-weight:800;color:${soldeColor(j.solde_final)}">${fmt(j.solde_final)}</div>
                </div>
              </div>
              <!-- Flèche -->
              <div style="text-align:right;margin-top:8px;font-size:11px;color:#94a3b8">
                Voir les mouvements →
              </div>
            </div>
          </div>`;
        }).join('')}
       </div>`;

  // ── Tableau récapitulatif ────────────────────────────────────────────────
  const tableHtml = `
  <div style="background:white;border-radius:14px;border:1px solid var(--border);overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,.06)">
    <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border);background:linear-gradient(90deg,#f8fafc,#fff)">
      <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#0369a1,#075985);
        display:inline-flex;align-items:center;justify-content:center;color:white;font-size:15px">📊</div>
      <div>
        <div style="font-size:14px;font-weight:700;color:#0f172a">Tableau récapitulatif — ${state.mois} ${state.annee}</div>
        <div style="font-size:11px;color:#64748b">${journaux.length} journal${journaux.length>1?'x':''} de caisse</div>
      </div>
    </div>
    <div class="table-wrap" style="margin:0">
      <table>
        <thead>
          <tr>
            <th>Journal</th>
            <th>Type</th>
            <th style="text-align:right">RAN</th>
            <th style="text-align:right">Entrées</th>
            <th style="text-align:right">Sorties</th>
            <th style="text-align:right">Solde final</th>
            <th style="text-align:center">Statut</th>
          </tr>
        </thead>
        <tbody>
          ${journaux.map(j => `
          <tr onclick="navigateToJournal(${j.id})" style="cursor:pointer"
            onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
            <td>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:16px">${ICONS[j.type]||'📒'}</span>
                <span style="font-weight:600">${j.nom}</span>
                <span style="background:#f1f5f9;color:#64748b;font-size:10px;font-weight:700;padding:1px 6px;border-radius:5px">${j.code}</span>
              </div>
            </td>
            <td><span style="color:${TYPE_COLOR[j.type]||'#64748b'};font-weight:600;font-size:12px">${TYPE_LABEL[j.type]||j.type}</span></td>
            <td style="text-align:right;color:#92400e;font-weight:600">${fmt(j.ran)}</td>
            <td style="text-align:right;color:#16a34a;font-weight:700">${fmt(j.total_entrees)}</td>
            <td style="text-align:right;color:#dc2626;font-weight:700">${fmt(j.total_sorties)}</td>
            <td style="text-align:right;font-weight:800;color:${soldeColor(j.solde_final)}">${fmt(j.solde_final)}</td>
            <td style="text-align:center">
              ${j.arrete
                ? `<span style="background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;padding:3px 8px;border-radius:12px">🔒 Arrêtée</span>`
                : `<span style="background:#fef9c3;color:#92400e;font-size:11px;font-weight:700;padding:3px 8px;border-radius:12px">🔓 Ouverte</span>`}
            </td>
          </tr>`).join('')}
          ${banque.solde_final > 0 || banque.fonds_recus > 0 ? `
          <tr style="background:#faf5ff;border-top:2px solid #e9d5ff">
            <td>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:16px">🏦</span>
                <span style="font-weight:600;color:#7c3aed">Banque</span>
              </div>
            </td>
            <td><span style="color:#7c3aed;font-weight:600;font-size:12px">Compte bancaire</span></td>
            <td style="text-align:right;color:#92400e;font-weight:600">${fmt(banque.solde_initial)}</td>
            <td style="text-align:right;color:#16a34a;font-weight:700">${fmt(banque.fonds_recus)}</td>
            <td style="text-align:right;color:#dc2626;font-weight:700">—</td>
            <td style="text-align:right;font-weight:800;color:#7c3aed">${fmt(banque.solde_final)}</td>
            <td></td>
          </tr>` : ''}
        </tbody>
        <tfoot>
          <tr style="background:linear-gradient(90deg,#0f172a,#1e293b);color:white;font-weight:800">
            <td colspan="2" style="color:white">TOTAL GÉNÉRAL</td>
            <td style="text-align:right;color:#fde68a">${fmt(totalRan)}</td>
            <td style="text-align:right;color:#86efac">${fmt(totalEntrees)}</td>
            <td style="text-align:right;color:#fca5a5">${fmt(totalSorties)}</td>
            <td style="text-align:right;color:#93c5fd;font-size:15px">${fmt(totalSolde + banque.solde_final)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>`;

  // ── Rendu final ──────────────────────────────────────────────────────────
  container.innerHTML = `
    <!-- Titre -->
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:18px">
      <div>
        <h2 style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:4px">📒 Journaux de caisse</h2>
        <div style="font-size:12px;color:#64748b">${state.mois} ${state.annee} · Vue d'ensemble consolidée</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button onclick="printJournauxRecap()"
          style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;
            background:linear-gradient(135deg,#1e293b,#0f172a);border:none;border-radius:9px;
            font-size:12px;font-weight:600;color:white;cursor:pointer;
            box-shadow:0 2px 8px rgba(15,23,42,.25);transition:all .15s"
          onmouseover="this.style.transform='translateY(-1px)'"
          onmouseout="this.style.transform=''">
          🖨️ Imprimer le récap
        </button>
        <button onclick="loadJournauxRecap()"
          style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;
            background:white;border:1px solid var(--border);border-radius:9px;
            font-size:12px;font-weight:600;color:#475569;cursor:pointer;
            box-shadow:0 1px 4px rgba(0,0,0,.06);transition:all .15s"
          onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
          ↺ Actualiser
        </button>
      </div>
    </div>
    ${kpiHtml}
    ${cardsHtml}
    ${tableHtml}`;
};

window.navigateToJournal = (journalId) => {
  const j = state.journaux.find(j => j.id === journalId);
  if (!j) { toast('Journal introuvable.','error'); return; }
  state.journalActif = j;
  // Activer le nav-item "Journaux de caisse" dans Reporting
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.querySelector(`.nav-item[data-page="journaux-recap"]`);
  if (navEl) navEl.classList.add('active');
  showPage('journal-view', { sourceElement: navEl || undefined });
};

// ── BUDGET & RÉALISATIONS ─────────────────────────────────────────────────
const loadBudget = async () => {
  const container=$('budget-content');
  const [budgetData, cumuls] = await Promise.all([
    api.get(`/budget?mois=${state.mois}&annee=${state.annee}`),
    api.get(`/journal/cumuls?mois=${state.mois}&annee=${state.annee}`),
  ]);
  if(budgetData.error){container.innerHTML=`<div class="alert-err">${budgetData.error}</div>`;return;}

  const realisations={};
  (cumuls||[]).forEach(r=>{
    if(!realisations[r.rubrique_code])realisations[r.rubrique_code]=0;
    realisations[r.rubrique_code]+=parseFloat(r.total_sorties)||0;
  });

  const v=budgetData.validation||{statut:'en_attente'};
  const canValidate=['directeur','super_admin'].includes(state.user?.role);
  const sCls={valide:'statut-valide',rejete:'statut-rejete',en_attente:'statut-attente'};

  let totalDot=0, totalReal=0;
  const lignes=(budgetData.dotations||[]).map(d=>{
    const montant=parseFloat(d.montant)||0;
    const real=realisations[d.rubrique_code]||0;
    const ecart=montant-real; const pct=montant>0?Math.round(real/montant*100):0;
    totalDot+=montant; totalReal+=real;
    const intituleEsc=d.intitule.replace(/'/g,"\\'");
    return `<tr class="budget-ligne-detail" style="cursor:pointer"
        onclick="showRubriqueDetail('${d.rubrique_code}','${intituleEsc}',${montant},${real})"
        title="Voir les mouvements de ${d.rubrique_code}">
      <td><span class="badge-rubrique">${d.rubrique_code}</span></td>
      <td>${d.intitule}
        <span style="font-size:11px;color:var(--text-light);margin-left:6px">▶ détail</span>
      </td>
      <td style="text-align:right">${fmt(montant)}</td>
      <td style="text-align:right;font-weight:600;color:${real>0?'var(--accent-red)':'var(--text-light)'}">
        ${fmt(real)}</td>
      <td style="text-align:right">
        <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
          <div style="width:60px;height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden">
            <div style="width:${Math.min(pct,100)}%;height:100%;background:${pct>90?'var(--accent-red)':pct>70?'#f59e0b':'var(--accent-green)'}"></div>
          </div>
          <span style="font-size:11px;color:var(--text-muted)">${pct}%</span>
        </div>
      </td>
      <td style="text-align:right;font-weight:600;color:${ecart>=0?'var(--accent-green)':'var(--accent-red)'}">
        ${fmt(Math.abs(ecart))} ${ecart<0?'⚠️':''}</td>
    </tr>`;
  }).join('');

  const totalEcart=totalDot-totalReal;

  container.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <h2 style="font-size:16px;font-weight:700">Suivi Budgétaire — ${state.mois} ${state.annee}</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="statut-badge ${sCls[v.statut]||''}">${v.statut.replace('_',' ')}</span>
        ${canValidate?`
          <button class="btn-add" style="font-size:12px;padding:6px 12px"
            onclick="openModalBudgetLine()">+ Dotation</button>
          <button class="btn-ghost" style="font-size:12px"
            onclick="validerBudget('valide')">✅ Valider</button>
          <button class="btn-ghost" style="font-size:12px;color:var(--accent-red)"
            onclick="validerBudget('rejete')">✕ Rejeter</button>`:''}
      </div>
    </div>

    <!-- KPIs résumé -->
    <div class="kpi-grid" style="margin-bottom:16px">
      <div class="kpi-card"><div class="kpi-icon kpi-blue"><svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
        <div class="kpi-body"><p class="kpi-label">Budget Total</p><p class="kpi-value" style="font-size:16px">${fmt(totalDot)}</p></div></div>
      <div class="kpi-card"><div class="kpi-icon kpi-red"><svg viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg></div>
        <div class="kpi-body"><p class="kpi-label">Réalisé</p><p class="kpi-value" style="font-size:16px">${fmt(totalReal)}</p></div></div>
      <div class="kpi-card"><div class="kpi-icon ${totalEcart>=0?'kpi-green':'kpi-red'}">
        <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
        <div class="kpi-body"><p class="kpi-label">${totalEcart>=0?'Économies':'Dépassement'}</p>
          <p class="kpi-value" style="font-size:16px;color:${totalEcart>=0?'var(--accent-green)':'var(--accent-red)'}">
            ${fmt(Math.abs(totalEcart))}</p></div></div>
      <div class="kpi-card"><div class="kpi-icon kpi-purple">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <div class="kpi-body"><p class="kpi-label">Taux exécution</p>
          <p class="kpi-value" style="font-size:16px">${totalDot>0?Math.round(totalReal/totalDot*100):0}%</p></div></div>
    </div>

    <!-- Tableau -->
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Code</th><th>Intitulé</th><th style="text-align:right">Dotation</th>
          <th style="text-align:right">Réalisé</th><th>Progression</th>
          <th style="text-align:right">Écart</th>
        </tr></thead>
        <tbody>${lignes||'<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">Aucune dotation ce mois.</td></tr>'}</tbody>
        <tfoot><tr style="background:#f8fafc;font-weight:700">
          <td colspan="2">TOTAL</td>
          <td style="text-align:right">${fmt(totalDot)}</td>
          <td style="text-align:right">${fmt(totalReal)}</td>
          <td></td>
          <td style="text-align:right;color:${totalEcart>=0?'var(--accent-green)':'var(--accent-red)'}">
            ${fmt(Math.abs(totalEcart))}</td>
        </tr></tfoot>
      </table>
    </div>

    ${canValidate ? `
    <!-- ── Dépassements de budget (directeurs) ─────────────────────────── -->
    <div style="margin-top:28px">
      <div style="background:linear-gradient(135deg,#991b1b 0%,#7f1d1d 100%);
        border-radius:16px;padding:22px 26px;margin-bottom:16px;
        box-shadow:0 4px 24px rgba(127,29,29,.22);position:relative;overflow:hidden">
        <div style="position:absolute;top:-20px;right:-20px;width:100px;height:100px;
          border-radius:50%;background:rgba(255,255,255,.06);pointer-events:none"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-size:18px;font-weight:800;color:white">⚠️ Dépassements de budget</div>
            <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:3px">
              Dépenses bloquées en attente de votre validation — ${state.mois} ${state.annee}
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button onclick="refreshDepassementsBudget()"
              style="padding:7px 14px;border-radius:9px;font-size:12px;cursor:pointer;
                border:1px solid rgba(255,255,255,.2);background:transparent;color:rgba(255,255,255,.7)">↺ Actualiser</button>
            <button onclick="window._depFilter='all';refreshDepassementsBudget()"
              style="padding:7px 14px;border-radius:9px;font-size:12px;cursor:pointer;
                border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:white;font-weight:600">
              Voir tout l'historique
            </button>
          </div>
        </div>
      </div>
      <div id="dep-list-in-budget">
        <div style="text-align:center;padding:40px;color:#94a3b8">
          <div style="font-size:24px;margin-bottom:8px">⏳</div>Chargement…
        </div>
      </div>
    </div>

    <!-- ── Dépenses en attente d'autorisation (RG-03 / RG-04) ────────────── -->
    <div style="margin-top:28px">
      <div style="background:linear-gradient(135deg,#744210 0%,#5c340d 100%);
        border-radius:16px;padding:22px 26px;margin-bottom:16px;
        box-shadow:0 4px 24px rgba(116,66,16,.22)">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-size:18px;font-weight:800;color:white">⏳ Dépenses en attente d'autorisation</div>
            <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:3px">
              Sorties bloquées (mois non validé ou montant prévu dépassé) — ${state.mois} ${state.annee}
            </div>
          </div>
          <button onclick="refreshMouvementsAttente()"
            style="padding:7px 14px;border-radius:9px;font-size:12px;cursor:pointer;
              border:1px solid rgba(255,255,255,.2);background:transparent;color:rgba(255,255,255,.7)">↺ Actualiser</button>
        </div>
      </div>
      <div id="mvt-attente-list">
        <div style="text-align:center;padding:40px;color:#94a3b8">
          <div style="font-size:24px;margin-bottom:8px">⏳</div>Chargement…
        </div>
      </div>
    </div>` : ''}`;

  // Charger les dépassements + dépenses en attente (directeur)
  if (canValidate) { await refreshDepassementsBudget(); await refreshMouvementsAttente(); }
};

// ── Dépenses en attente d'autorisation (RG-03 / RG-06 / RG-04) ──────────────
const MOTIF_ATTENTE = {
  rubrique_non_approuvee: ['#fef3c7','#92400e','Rubrique non budgétisée'],
  mois_non_valide:        ['#fef3c7','#92400e','Mois non validé'],
  depassement_journal:    ['#fee2e2','#991b1b','Plafond caisse dépassé'],
  depassement_rubrique:   ['#fee2e2','#991b1b','Budget approuvé dépassé'],
};
// Carte d'une dépense en attente (withMonth : affiche le mois, pour la vue tous-mois)
function mvtAttenteCard(m, withMonth){
  const fmt=n=>(parseFloat(n)||0).toLocaleString('fr-FR')+' FCFA';
  const [bg,fg,lbl]=MOTIF_ATTENTE[m.motif_attente]||['#e2e8f0','#475569','En attente'];
  const motif=`<span style="background:${bg};color:${fg};font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px">${lbl}</span>`;
  const refLabel=m.motif_attente==='depassement_journal'?'Plafond':'Approuvé';
  const info=(m.motif_attente==='depassement_rubrique'||m.motif_attente==='depassement_journal')
    ? `<div style="font-size:12px;color:#475569;margin-top:4px">${refLabel} : ${fmt(m.montant_prevu)} · Déjà sorti : ${fmt(m.cumul_sorties)}</div>` : '';
  const periode=withMonth?`${m.mois} ${m.annee} · `:'';
  return `<div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:10px;background:white">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
      <div style="min-width:200px">
        <div style="font-weight:700;color:#0f172a">${m.intitule} ${motif}</div>
        <div style="font-size:12px;color:#64748b;margin-top:3px">
          ${periode}<span class="badge">${m.rubrique_code}</span> · ${m.beneficiaire||'—'} · ${m.journal_nom||''} · ${m.date}
        </div>${info}
      </div>
      <div style="text-align:right">
        <div style="font-size:16px;font-weight:800;color:#dc2626">${fmt(m.sortie)}</div>
        <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end">
          <button class="btn-ghost" style="font-size:12px" onclick="rejeterMvtAttente(${m.id})">✕ Rejeter</button>
          <button class="btn-primary" style="width:auto;margin-top:0;font-size:12px" onclick="approuverMvtAttente(${m.id})">✓ Approuver</button>
        </div>
      </div>
    </div></div>`;
}

// Section contextuelle sur la page Budget (filtrée sur le mois affiché)
async function refreshMouvementsAttente(){
  const el=$('mvt-attente-list'); if(!el) return;
  const res=await api.get(`/mouvements-attente?mois=${encodeURIComponent(state.mois)}&annee=${state.annee}&statut=en_attente`);
  const list=(res&&res.mouvements)||[];
  el.innerHTML = list.length
    ? list.map(m=>mvtAttenteCard(m,false)).join('')
    : `<div style="text-align:center;padding:32px;color:#94a3b8">✅ Aucune dépense en attente pour ${state.mois} ${state.annee}.</div>`;
}
window.refreshMouvementsAttente=refreshMouvementsAttente;

// Page dédiée directeur : TOUTES les dépenses en attente, tous mois confondus
async function loadMouvementsAttentePage(){
  const container=$('attente-content'); if(!container) return;
  const res=await api.get(`/mouvements-attente?statut=en_attente`);
  if(res && res.error){ container.innerHTML=`<div class="alert-err">${res.error}</div>`; return; }
  const list=(res&&res.mouvements)||[];
  const fmt=n=>(parseFloat(n)||0).toLocaleString('fr-FR')+' FCFA';
  const total=(res&&res.total_en_attente)||0;

  if(!list.length){
    container.innerHTML=`
      <div style="background:white;border:1px solid var(--border);border-radius:16px;padding:60px 40px;text-align:center">
        <div style="font-size:40px;margin-bottom:12px">✅</div>
        <div style="font-size:16px;font-weight:700;color:#0f172a">Aucune dépense en attente</div>
        <div style="font-size:13px;color:#94a3b8;margin-top:4px">Toutes les demandes de la caisse ont été traitées.</div>
      </div>`;
    return;
  }

  // Regroupement par mois/année
  const groupes={};
  list.forEach(m=>{ const k=`${m.mois} ${m.annee}`; (groupes[k]=groupes[k]||[]).push(m); });

  container.innerHTML=`
    <div style="background:linear-gradient(135deg,#744210,#5c340d);border-radius:16px;padding:22px 26px;margin-bottom:18px;
      box-shadow:0 4px 24px rgba(116,66,16,.22);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div>
        <div style="font-size:19px;font-weight:800;color:white">⏳ Dépenses en attente d'autorisation</div>
        <div style="font-size:12px;color:rgba(255,255,255,.65);margin-top:3px">
          ${list.length} demande${list.length>1?'s':''} initiée${list.length>1?'s':''} par la caisse, à approuver ou rejeter
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:rgba(255,255,255,.6);text-transform:uppercase;font-weight:700">Total en attente</div>
        <div style="font-size:22px;font-weight:800;color:white">${fmt(total)}</div>
      </div>
    </div>
    ${Object.keys(groupes).map(k=>`
      <div style="margin-bottom:20px">
        <div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px 2px">${k}</div>
        ${groupes[k].map(m=>mvtAttenteCard(m,false)).join('')}
      </div>`).join('')}`;
}
window.loadMouvementsAttentePage=loadMouvementsAttentePage;

// Badge du menu (toutes périodes)
async function updateAttenteBadge(){
  const badge=$('badge-attente'); if(!badge) return;
  try{
    const res=await api.get(`/mouvements-attente/count`);
    const nb=(res&&res.nb)||0;
    badge.textContent=nb;
    badge.style.display = nb>0 ? 'inline-flex' : 'none';
  }catch(_){ badge.style.display='none'; }
}
window.updateAttenteBadge=updateAttenteBadge;

// Rafraîchit toutes les vues concernées après une décision
async function refreshAttenteViews(){
  await updateAttenteBadge();
  if(state.currentPage==='attente') await loadMouvementsAttentePage();
  if($('mvt-attente-list')) await refreshMouvementsAttente();
}

window.approuverMvtAttente=async(id)=>{
  if(!confirm('Approuver cette dépense ? Elle sera écrite dans le journal de caisse.')) return;
  const res=await api.patch(`/mouvements-attente/${id}/approuver`,{});
  if(res.error){toast(res.error,'error');return;}
  toast('Dépense approuvée et enregistrée ✓','success');
  await refreshAttenteViews();
};
window.rejeterMvtAttente=async(id)=>{
  const commentaire=prompt('Motif du rejet (optionnel) :')||'';
  const res=await api.patch(`/mouvements-attente/${id}/rejeter`,{commentaire});
  if(res.error){toast(res.error,'error');return;}
  toast('Dépense rejetée.','warning');
  await refreshAttenteViews();
};

// ── Cloche de notifications (in-app, bidirectionnelle) ──────────────────────
const NOTIF_ICONS = {
  attente_creee:     '📤',
  attente_approuvee: '✅',
  attente_rejetee:   '❌',
};
function tempsRelatif(iso){
  const d=new Date(iso), diff=(Date.now()-d.getTime())/1000;
  if(diff<60) return "à l'instant";
  if(diff<3600) return `il y a ${Math.floor(diff/60)} min`;
  if(diff<86400) return `il y a ${Math.floor(diff/3600)} h`;
  if(diff<172800) return 'hier';
  return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
}
async function updateNotifBadge(){
  const badge=$('badge-cloche'); if(!badge) return;
  try{
    const res=await api.get('/notifications/count');
    const nb=(res&&res.nb)||0;
    badge.textContent=nb>99?'99+':nb;
    badge.style.display = nb>0 ? 'block' : 'none';
  }catch(_){ badge.style.display='none'; }
}
window.updateNotifBadge=updateNotifBadge;

async function loadNotifications(){
  const el=$('notif-list'); if(!el) return;
  const res=await api.get('/notifications?limit=30');
  const list=(res&&res.notifications)||[];
  if(!list.length){
    el.innerHTML=`<div style="padding:32px;text-align:center;color:#94a3b8;font-size:13px">Aucune notification.</div>`;
    return;
  }
  el.innerHTML=list.map(n=>{
    const ico=NOTIF_ICONS[n.type]||'🔔';
    const bg=n.lu?'#fff':'#eff6ff';
    const dot=n.lu?'':'<span style="width:8px;height:8px;border-radius:50%;background:#2563eb;flex-shrink:0;margin-top:6px"></span>';
    return `<div onclick="ouvrirNotification(${n.id},'${n.type}','${n.ref_id}')"
        style="display:flex;gap:10px;padding:12px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;background:${bg}">
        ${dot||'<span style="width:8px;flex-shrink:0"></span>'}
        <div style="font-size:18px;flex-shrink:0;line-height:1.2">${ico}</div>
        <div style="min-width:0;flex:1">
          <div style="font-weight:700;color:#0f172a;font-size:13px">${n.titre}</div>
          <div style="font-size:12px;color:#475569;margin-top:2px;line-height:1.35">${n.message}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px">${tempsRelatif(n.created_at)}</div>
        </div>
      </div>`;
  }).join('');
}

window.toggleNotifications=async(e)=>{
  if(e) e.stopPropagation();
  const panel=$('notif-panel'); if(!panel) return;
  const open = panel.style.display==='flex';
  if(open){ panel.style.display='none'; return; }
  panel.style.display='flex';
  await loadNotifications();
};
window.ouvrirNotification=async(id,type,refId)=>{
  await api.patch(`/notifications/${id}/lu`,{});
  await updateNotifBadge();
  // Le directeur va vers la file d'attente ; le créateur reste informé.
  if(type==='attente_creee' && $('nav-attente') && $('nav-attente').style.display!=='none'){
    $('notif-panel').style.display='none';
    showPage('attente');
  } else {
    await loadNotifications();
  }
};
window.marquerToutesLues=async()=>{
  await api.patch('/notifications/lu-tout',{});
  await updateNotifBadge();
  await loadNotifications();
};
// Fermer le panneau au clic extérieur
document.addEventListener('click',(e)=>{
  const panel=$('notif-panel'), wrap=e.target.closest('.notif-wrap');
  if(panel && panel.style.display==='flex' && !wrap){ panel.style.display='none'; }
});

window.validerBudget=async(statut)=>{
  const commentaire=prompt(`Commentaire (optionnel) pour : ${statut}`)||'';
  const res=await api.post('/budget/validation',{mois:state.mois,annee:state.annee,statut,commentaire});
  if(res.error){toast(res.error,'error');return;}
  toast(`Budget ${statut} ✓`,'success'); await loadBudget();
};

window.openModalBudgetLine=()=>{
  const opts=(state.rubriques.depenses||[]).map(r=>
    `<option value="${r.code}">[${r.code}] ${r.intitule}</option>`).join('');
  const html=`
    <div class="modal-overlay" id="modal-budget-line" onclick="if(event.target===this)closeMBL()">
      <div class="modal-box" style="max-width:440px">
        <div class="modal-head"><h3>+ Nouvelle dotation</h3>
          <button class="modal-close" onclick="closeMBL()">✕</button></div>
        <div class="modal-body">
          <label>Rubrique *</label><select id="bl-rubrique">${opts}</select>
          <label>Montant *</label><input id="bl-montant" type="number" min="0" placeholder="0"/>
          <div id="bl-err" class="alert-err" style="display:none;margin-top:10px"></div>
        </div>
        <div class="modal-foot">
          <button class="btn-ghost" onclick="closeMBL()">Annuler</button>
          <button class="btn-primary" style="width:auto;margin-top:0" onclick="saveBudgetLine()">💾 Enregistrer</button>
        </div>
      </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
};
window.closeMBL=()=>{const m=$('modal-budget-line');if(m)m.remove();};
window.saveBudgetLine=async()=>{
  const rubrique=$('bl-rubrique').value;
  const montant=parseFloat($('bl-montant').value)||0;
  if(!rubrique||montant<=0){$('bl-err').textContent='Données invalides.';$('bl-err').style.display='block';return;}
  const r=state.rubriques.depenses.find(x=>x.code===rubrique);
  const res=await api.put('/budget',{mois:state.mois,annee:state.annee,
    rubrique_code:rubrique,intitule:r?.intitule||rubrique,montant});
  if(res.error){$('bl-err').textContent=res.error;$('bl-err').style.display='block';return;}
  closeMBL(); toast('Dotation enregistrée ✓','success'); await loadBudget();
};

// ── DÉTAIL RUBRIQUE — mouvements regroupés ────────────────────────────
window.showRubriqueDetail = async (code, intitule, dotation, realise) => {
  const mid = 'modal-rubrique-detail';
  const existing = document.getElementById(mid);
  if (existing) existing.remove();

  // Skeleton pendant le chargement
  const pct = dotation > 0 ? Math.round(realise / dotation * 100) : 0;
  const ecart = dotation - realise;
  const couleurEcart = ecart >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  const couleurPct   = pct > 90 ? 'var(--accent-red)' : pct > 70 ? '#f59e0b' : 'var(--accent-green)';

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="${mid}" onclick="if(event.target===this)closeRubriqueDetail()">
      <div class="modal-box" style="max-width:720px">
        <div class="modal-head">
          <h3>
            <span class="badge-rubrique" style="font-size:12px">${code}</span>
            &nbsp;${intitule}
          </h3>
          <button class="modal-close" onclick="closeRubriqueDetail()">✕</button>
        </div>
        <div class="modal-body" id="rub-detail-body">

          <!-- KPIs synthèse -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">
            <div style="background:#f8fafc;border:1px solid var(--border);border-radius:10px;padding:14px 16px">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                color:var(--text-muted);margin-bottom:6px">Dotation</div>
              <div style="font-size:18px;font-weight:700;color:var(--accent)">${fmt(dotation)}</div>
            </div>
            <div style="background:#f8fafc;border:1px solid var(--border);border-radius:10px;padding:14px 16px">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                color:var(--text-muted);margin-bottom:6px">Réalisé</div>
              <div style="font-size:18px;font-weight:700;color:var(--accent-red)">${fmt(realise)}</div>
            </div>
            <div style="background:#f8fafc;border:1px solid var(--border);border-radius:10px;padding:14px 16px">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                color:var(--text-muted);margin-bottom:6px">${ecart>=0?'Économies':'Dépassement'}</div>
              <div style="font-size:18px;font-weight:700;color:${couleurEcart}">${fmt(Math.abs(ecart))}</div>
            </div>
          </div>

          <!-- Barre de progression -->
          <div style="margin-bottom:18px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:12px;font-weight:600;color:var(--text-muted)">Taux d'exécution</span>
              <span style="font-size:13px;font-weight:700;color:${couleurPct}">${pct}%</span>
            </div>
            <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
              <div style="width:${Math.min(pct,100)}%;height:100%;background:${couleurPct};
                border-radius:4px;transition:width .4s ease"></div>
            </div>
          </div>

          <div class="form-section" style="margin-top:0">Mouvements — ${state.mois} ${state.annee}</div>

          <!-- Tableau mouvements -->
          <div id="rub-mvt-table" style="margin-top:12px">
            <div style="text-align:center;padding:24px;color:var(--text-muted)">
              <div class="spinner spinner-lg" style="margin:0 auto 10px"></div>
              Chargement des mouvements…
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn-ghost" onclick="closeRubriqueDetail()">Fermer</button>
        </div>
      </div>
    </div>`);

  // Charger les mouvements
  const data = await api.get(
    `/journal?mois=${state.mois}&annee=${state.annee}&rubrique_code=${encodeURIComponent(code)}`
  );

  const mvts = (data && data.mouvements) || [];
  const tbl = document.getElementById('rub-mvt-table');
  if (!tbl) return;

  if (!mvts.length) {
    tbl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);
      font-size:13px">Aucun mouvement enregistré pour cette rubrique ce mois-ci.</div>`;
    return;
  }

  const lignes = mvts.map(m => {
    const montant = parseFloat(m.sortie || 0) || parseFloat(m.entree || 0);
    const isSortie = parseFloat(m.sortie || 0) > 0;
    const journalLabel = m.journal_nom ? `${m.journal_nom}` : (m.journal_code || '—');
    const dateStr = m.date ? new Date(m.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
    return `<tr>
      <td style="white-space:nowrap">${dateStr}</td>
      <td><span style="font-size:11px;background:#eff6ff;color:#1d4ed8;padding:2px 7px;
        border-radius:4px;font-weight:600">${journalLabel}</span></td>
      <td>${m.intitule || '—'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${m.beneficiaire || m.objet || ''}</td>
      <td style="text-align:right;font-weight:600;color:${isSortie?'var(--accent-red)':'var(--accent-green)'}">
        ${isSortie?'-':'+'} ${fmt(montant)}</td>
    </tr>`;
  }).join('');

  const totalMvt = mvts.reduce((s,m)=>s+(parseFloat(m.sortie||0)||parseFloat(m.entree||0)),0);

  tbl.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Date</th><th>Journal</th><th>Intitulé</th>
          <th>Bénéficiaire / Objet</th><th style="text-align:right">Montant</th>
        </tr></thead>
        <tbody>${lignes}</tbody>
        <tfoot><tr style="background:#f8fafc;font-weight:700">
          <td colspan="4">TOTAL (${mvts.length} mouvement${mvts.length>1?'s':''})</td>
          <td style="text-align:right;color:var(--accent-red)">${fmt(totalMvt)}</td>
        </tr></tfoot>
      </table>
    </div>`;
};

window.closeRubriqueDetail = () => {
  const m = document.getElementById('modal-rubrique-detail');
  if (m) m.remove();
};

// ── PRÉVISIONS DE FONDS ───────────────────────────────────────────────────
const MOIS_LISTE = ['Janvier','Février','Mars','Avril','Mai','Juin',
                    'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

const moisSuivant = (mois, annee) => {
  const idx = MOIS_LISTE.indexOf(mois);
  if (idx === -1) return { mois, annee };
  return idx === 11
    ? { mois: MOIS_LISTE[0], annee: annee + 1 }
    : { mois: MOIS_LISTE[idx + 1], annee };
};

const loadPrevisions = async () => {
  const container = $('previsions-content');
  container.innerHTML = `<div style="text-align:center;padding:60px 0;color:var(--text-muted)">
    <div class="spinner spinner-lg" style="margin:0 auto 12px"></div>Chargement…</div>`;

  await loadRubriques();
  const rubriques = state.rubriques.depenses || [];

  // Lire la sélection en cours ou utiliser mois suivant par défaut
  const selM = document.getElementById('prev-sel-mois');
  const selA = document.getElementById('prev-sel-annee');
  const def  = moisSuivant(state.mois, state.annee);
  const moisCible  = selM ? selM.value        : def.mois;
  const anneeCible = selA ? parseInt(selA.value) : def.annee;

  // Charger le budget existant pour ce mois cible
  const data = await api.get(`/budget?mois=${moisCible}&annee=${anneeCible}`);
  if (!data || data.error) {
    container.innerHTML = `<div class="alert-err">${(data && data.error)||'Erreur de chargement.'}</div>`;
    return;
  }

  // Map code → dotation existante
  const existing = {};
  (data.dotations || []).forEach(d => { existing[d.rubrique_code] = d; });
  window._previsCtx = { moisCible, anneeCible, existing };

  // Selectors options
  const optsM = MOIS_LISTE.map(m =>
    `<option value="${m}" ${m===moisCible?'selected':''}>${m}</option>`).join('');
  const anneeMin = (state.annee || new Date().getFullYear()) - 1;
  const optsA = Array.from({length:6},(_,i)=>anneeMin+i).map(a =>
    `<option value="${a}" ${a===anneeCible?'selected':''}>${a}</option>`).join('');

  // Total initial
  const totalInit = Object.values(existing).reduce((s,d)=>s+(parseFloat(d.montant)||0), 0);

  // Lignes de saisie — une par rubrique
  const rows = rubriques.length ? rubriques.map(r => {
    const ex  = existing[r.code];
    const val = ex ? parseFloat(ex.montant) : 0;
    return `<div class="prev-row" data-code="${r.code}"
               data-id="${ex ? ex.id : ''}"
               data-intitule="${r.intitule.replace(/"/g,'&quot;')}">
      <span class="badge-rubrique">${r.code}</span>
      <span class="prev-row-name" title="${r.intitule}">${r.intitule}</span>
      <div class="prev-amount-wrap">
        <input type="number" min="0" step="1000"
          value="${val > 0 ? val : ''}"
          placeholder="0"
          class="prev-amount-input${val > 0 ? ' has-value' : ''}"
          oninput="onPrevInput(this)"
          onfocus="this.select()"/>
        <span class="suffix">FCFA</span>
      </div>
    </div>`;
  }).join('') : `<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px">
      Aucune rubrique de dépenses configurée.<br>
      <small>Ajoutez des rubriques dans <b>Configuration</b>.</small></div>`;

  const nbSaisis = Object.keys(existing).length;

  container.innerHTML = `
    <!-- Titre page -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">
      <h2 style="font-size:16px;font-weight:700">Prévisions de Fonds</h2>
      <span style="font-size:12px;color:var(--text-muted)">${rubriques.length} rubrique(s) de dépenses</span>
    </div>

    <!-- Barre de sélection de période -->
    <div class="prev-period-bar">
      <svg style="width:18px;height:18px;stroke:var(--accent);fill:none;stroke-width:2;stroke-linecap:round;flex-shrink:0"
        viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <label>Budget du mois de</label>
      <select id="prev-sel-mois" onchange="loadPrevisions()">${optsM}</select>
      <select id="prev-sel-annee" onchange="loadPrevisions()">${optsA}</select>
      <div style="height:24px;width:1px;background:var(--border);margin:0 4px"></div>
      <span style="font-size:12px;color:var(--text-muted)">
        ${nbSaisis > 0
          ? `<span style="color:var(--accent-green);font-weight:700">${nbSaisis}</span> rubrique(s) budgétées`
          : 'Aucune saisie pour ce mois'}
      </span>
    </div>

    <!-- Bannière info -->
    <div class="prev-info-banner">
      <svg style="width:18px;height:18px;stroke:#3b82f6;fill:none;stroke-width:2;stroke-linecap:round;flex-shrink:0;margin-top:1px"
        viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>Saisissez les montants prévisionnels pour <b>${moisCible} ${anneeCible}</b>.
        Laissez <b>0</b> pour les rubriques non budgétées. Ces données alimenteront automatiquement
        la section <b>Prévision des dépenses</b> dans la Demande de Fonds.</span>
    </div>

    <!-- Grille de saisie -->
    <div class="prev-card">
      <div class="prev-card-head">
        <span class="prev-card-title">Saisie budgétaire — ${moisCible} ${anneeCible}</span>
        <span style="font-size:12px;color:var(--text-muted)">Cliquez sur un montant pour le modifier</span>
      </div>
      <div class="prev-col-head">
        <span>Code</span><span>Rubrique</span><span style="text-align:right;padding-right:4px">Montant prévisionnel</span>
      </div>
      <div id="prev-rows">${rows}</div>
      <div class="prev-total-row">
        <span></span>
        <span style="font-weight:700;color:var(--text)">TOTAL PRÉVISIONNEL</span>
        <span id="prev-total">${fmt(totalInit)}</span>
      </div>
    </div>

    <!-- Barre de sauvegarde -->
    <div class="prev-save-bar">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text)">
          Prêt à enregistrer le budget prévisionnel
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
          Les rubriques à 0 seront retirées du budget de <b>${moisCible} ${anneeCible}</b>
        </div>
      </div>
      <button class="btn-save-prev" id="btn-save-prev" onclick="savePrevisions()">
        <svg style="width:16px;height:16px;stroke:white;fill:none;stroke-width:2.5;stroke-linecap:round"
          viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        Enregistrer le budget — ${moisCible} ${anneeCible}
      </button>
    </div>`;
};

// Mise à jour live du total + badge "has-value"
window.onPrevInput = (inp) => {
  const v = parseFloat(inp.value) || 0;
  inp.classList.toggle('has-value', v > 0);
  let total = 0;
  document.querySelectorAll('.prev-amount-input').forEach(i => {
    total += parseFloat(i.value) || 0;
  });
  const el = document.getElementById('prev-total');
  if (el) el.textContent = fmt(total);
};

// Sauvegarde batch de toutes les lignes
window.savePrevisions = async () => {
  const ctx = window._previsCtx;
  if (!ctx) return;
  const { moisCible, anneeCible, existing } = ctx;

  const btn = document.getElementById('btn-save-prev');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>&nbsp;Enregistrement…'; }

  const rows    = document.querySelectorAll('.prev-row');
  const upserts = [];
  const deletes = [];

  rows.forEach(row => {
    const code     = row.dataset.code;
    const intitule = row.dataset.intitule;
    const id       = row.dataset.id;
    const montant  = parseFloat(row.querySelector('.prev-amount-input')?.value) || 0;
    const wasSet   = !!id;

    if (montant > 0) {
      upserts.push(api.put('/budget', {
        mois: moisCible, annee: anneeCible,
        rubrique_code: code, intitule, montant,
        mois_applic: moisCible, annee_applic: anneeCible,
      }));
    } else if (wasSet) {
      deletes.push(api.delete(`/budget/${id}`));
    }
  });

  const results = await Promise.all([...upserts, ...deletes]);
  const hasErr  = results.some(r => r && r.error);

  if (hasErr) {
    toast('Certaines lignes n\'ont pas pu être sauvegardées.', 'error');
  } else {
    const n = upserts.length;
    toast(`Budget de ${moisCible} ${anneeCible} enregistré — ${n} rubrique${n>1?'s':''} ✓`, 'success');
  }
  await loadPrevisions();
};

// ── APPEL DE FONDS ────────────────────────────────────────────────────────

// Générateur de bloc "attente" — défini au niveau module pour être réutilisable
// par le rechargement partiel (reloadBlocsAttente) sans refaire toute la page.
const buildBlocSelect = (num, titre, couleur, type, rows, isCaissiere) => {
  const liste = type==='dep' ? (state.rubriques.depenses||[]) : (state.rubriques.entrees||[]);
  const total = (rows||[]).reduce((s,r) => s+(parseFloat(r.montant)||0), 0);
  const opts = liste.map(r=>`<option value="${r.code}" data-int="${(r.intitule||'').replace(/"/g,'&quot;')}">[${r.code}] ${r.intitule}</option>`).join('');

  const formulaire = isCaissiere && liste.length ? `
    <div style="display:grid;grid-template-columns:220px 1fr 150px auto;gap:10px;align-items:flex-end;
         margin-bottom:14px;background:#f8fafc;padding:14px 16px;border-radius:10px;
         border:1px solid var(--border)">
      <div>
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
          color:var(--text-muted);display:block;margin-bottom:5px">Rubrique</label>
        <select id="af-${type}-rub" onchange="syncIntituleAF('${type}')" style="width:100%;
          padding:9px 30px 9px 11px;border:1.5px solid var(--border);border-radius:8px;
          font-size:13px;color:var(--text);background:#fff url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2714%22 height=%2714%22 viewBox=%270 0 24 24%22 fill=%27none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpolyline points=%226 9 12 15 18 9%22/%3E%3C/svg%3E') no-repeat right 8px center;
          appearance:none;-webkit-appearance:none;outline:none;cursor:pointer;
          transition:border-color .15s,box-shadow .15s">
          <option value="">— choisir —</option>${opts}
        </select>
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
          color:var(--text-muted);display:block;margin-bottom:5px">Intitulé</label>
        <input id="af-${type}-int" type="text" placeholder="Désignation (modifiable)"
          style="width:100%;padding:9px 11px;border:1.5px solid var(--border);border-radius:8px;
          font-size:13px;color:var(--text);background:white;outline:none;
          transition:border-color .15s,box-shadow .15s"/>
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
          color:var(--text-muted);display:block;margin-bottom:5px">Montant (FCFA)</label>
        <input id="af-${type}-mt" type="number" min="0" step="1000" placeholder="0"
          style="width:100%;padding:9px 11px;border:1.5px solid var(--border);border-radius:8px;
          font-size:13px;color:var(--text);background:white;outline:none;text-align:right;
          transition:border-color .15s,box-shadow .15s"/>
      </div>
      <button class="btn-add" style="padding:10px 18px;white-space:nowrap;align-self:flex-end"
        onclick="addLigneAttente('${type}')">＋ Ajouter</button>
    </div>` : (!liste.length ? `<div style="color:var(--text-muted);font-size:12px;margin-bottom:10px">
      Aucune rubrique configurée — ajoutez-en dans <b>Configuration</b>.</div>` : '');

  const lignes = (rows||[]).map(r=>`<tr>
    <td><span class="badge-rubrique">${r.rubrique_code}</span></td>
    <td>${r.intitule}</td>
    <td style="text-align:right;font-weight:600;color:${couleur}">${fmt(r.montant)}</td>
    ${isCaissiere?`<td style="text-align:center">
      <button class="btn-icon danger" title="Supprimer"
        onclick="delLigneAttente('${type}',${r.id})">🗑</button></td>`:''}
  </tr>`).join('');

  const tableau = rows && rows.length ? `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Rubrique</th><th>Intitulé</th>
        <th style="text-align:right">Montant</th>
        ${isCaissiere?'<th style="text-align:center;width:48px"></th>':''}
      </tr></thead>
      <tbody>${lignes}</tbody>
      <tfoot><tr style="background:#f8fafc;font-weight:700">
        <td colspan="2">TOTAL</td>
        <td style="text-align:right;color:${couleur}">${fmt(total)}</td>
        ${isCaissiere?'<td></td>':''}
      </tr></tfoot>
    </table></div>` : `<div style="color:var(--text-muted);font-size:13px;padding:10px 0;text-align:center">
      Aucune ligne ajoutée pour ${state.mois} ${state.annee}.</div>`;

  return `<div id="bloc-att-${type}" style="margin-bottom:22px">
    <b style="color:${couleur};display:block;margin-bottom:8px;font-size:13px">${num}. ${titre}</b>
    ${formulaire}${tableau}
  </div>`;
};

const loadAppelFonds = async () => {
  const container=$('appel-fonds-content');
  const isDirecteur = ['directeur','super_admin'].includes(state.user?.role);
  const isCaissiere = ['caissier','comptable_cabinet','directeur','super_admin'].includes(state.user?.role);

  // Spinner pendant le chargement initial
  container.innerHTML=`<div style="text-align:center;padding:48px 0;color:var(--text-muted)">
    <div style="font-size:28px;margin-bottom:8px">⏳</div><div>Chargement…</div></div>`;

  // Rubriques + données en parallèle
  const [,s,banque] = await Promise.all([
    loadRubriques(),
    api.get(`/appel-fonds/synthese?mois=${state.mois}&annee=${state.annee}`),
    api.get(`/banque?mois=${state.mois}&annee=${state.annee}`),
  ]);
  if(!s || s.error){
    container.innerHTML=`<div class="alert-err">${(s&&s.error)||'Erreur de chargement de la demande de fonds.'}</div>`;
    return;
  }
  window._afSynthese=s;

  const tr=s.tresorerie;
  const dispoApres=s.tresorerie_apres_attente;
  const approuve = (s.validation?.statut)==='valide';

  // ── Section 4 : prévision + validation + impression ──
  let bloc4;
  if(s.prevision.length===0){
    bloc4=`<div style="background:#fffbeb;border:1px solid #f6e05e;border-radius:7px;padding:16px;text-align:center;color:#744210;font-size:13px">
      <div style="font-size:22px;margin-bottom:6px">📋</div>
      <div style="font-weight:700;margin-bottom:4px">Aucune prévision saisie pour ${s.mois_cible} ${s.annee_cible}</div>
      <small style="color:#718096">La caissière doit saisir la prévision dans l'écran <b>Suivi Budgétaire</b>
        en choisissant le mois d'application : ${s.mois_cible} ${s.annee_cible}.</small></div>`;
  } else {
    const rowsPrev=s.prevision.map(r=>`<tr>
      <td><span class="badge-rubrique">${r.rubrique_code}</span></td>
      <td>${r.intitule}</td>
      <td style="text-align:right;font-weight:700">${fmt(r.montant)}</td></tr>`).join('');
    const badge = approuve
      ? `<span class="statut-badge statut-valide">✅ Approuvé le ${(s.validation.validated_at||'').substring(0,10)} — s'applique en ${s.mois_cible} ${s.annee_cible}</span>`
      : `<span class="statut-badge statut-attente">⏳ En attente — pour ${s.mois_cible} ${s.annee_cible}</span>`;
    const boutonsDir = isDirecteur ? (approuve
      ? `<button class="btn-ghost" style="font-size:12px;color:var(--text-muted)" onclick="statutDemande('en_attente')">↩ Remettre en attente</button>`
      : `<button class="btn-ghost" style="font-size:12px;color:var(--accent-green)" onclick="statutDemande('valide')">✅ Approuver la demande</button>
         <button class="btn-ghost" style="font-size:12px;color:var(--accent-red)" onclick="statutDemande('rejete')">↩ Refuser</button>`) : '';
    const bilan = s.besoin>0
      ? `<div style="background:#fff5f5;border:2px solid #e53e3e;border-radius:8px;padding:14px;text-align:center;margin-top:14px">
           <div style="font-size:11px;font-weight:700;color:#718096;text-transform:uppercase">Fonds supplémentaires à demander pour ${s.mois_cible}</div>
           <div style="font-size:26px;font-weight:700;color:var(--accent-red)">${fmt(s.besoin)}</div>
           <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Trésorerie disponible : ${fmt(s.tresorerie_disponible)} | Prévision : ${fmt(s.total_prevision)}</div></div>`
      : `<div style="background:#f0fff4;border:2px solid #38a169;border-radius:8px;padding:14px;text-align:center;margin-top:14px">
           <div style="font-size:11px;font-weight:700;color:#718096;text-transform:uppercase">Trésorerie suffisante pour couvrir ${s.mois_cible}</div>
           <div style="font-size:26px;font-weight:700;color:var(--accent-green)">${fmt(s.excedent)}</div>
           <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Trésorerie disponible : ${fmt(s.tresorerie_disponible)} | Prévision : ${fmt(s.total_prevision)}</div></div>`;
    const impression = approuve
      ? `<div style="text-align:center;margin-top:16px">
           <button class="btn-primary" style="width:auto" onclick="imprimerDemande()">🖨 Imprimer la Demande de Fonds</button>
           <div style="margin-top:6px;font-size:11px;color:var(--accent-green);font-weight:600">✓ Approuvé par ${s.validation.validated_by_nom||'le directeur'}</div></div>`
      : `<div style="text-align:center;margin-top:16px">
           <button class="btn-ghost" disabled style="opacity:.6;cursor:not-allowed">🖨 Imprimer la Demande de Fonds</button>
           <div style="margin-top:8px;font-size:12px;color:var(--accent-red)">🔒 ${isDirecteur?'Approuvez la demande pour activer l\'impression.':'En attente d\'approbation du directeur.'}</div></div>`;
    bloc4=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        ${badge}<div style="display:flex;gap:8px">${boutonsDir}</div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Rubrique</th><th>Intitulé</th><th style="text-align:right">Montant prévisionnel</th></tr></thead>
        <tbody>${rowsPrev}</tbody>
        <tfoot><tr style="background:#f8fafc;font-weight:700">
          <td colspan="2">TOTAL PRÉVISIONNEL</td>
          <td style="text-align:right">${fmt(s.total_prevision)}</td></tr></tfoot></table></div>
      ${bilan}${impression}`;
  }

  container.innerHTML=`
    <h2 style="font-size:16px;font-weight:700;margin-bottom:16px">Demande de Fonds — ${state.mois} ${state.annee}</h2>

    <b style="color:#1a365d;display:block;margin-bottom:8px;font-size:13px">1. Trésorerie Actuelle</b>
    <div class="table-wrap" style="margin-bottom:20px"><table>
      <thead><tr><th>Désignation</th><th style="text-align:right">Montant</th></tr></thead>
      <tbody>
        <tr><td>Solde caisse espèces</td><td style="text-align:right;color:var(--accent-green)">${fmt(tr.solde_espece)}</td></tr>
        <tr><td>Solde caisse OM</td><td style="text-align:right;color:var(--accent-green)">${fmt(tr.solde_om)}</td></tr>
        <tr><td>Solde final en banque</td>
          <td style="text-align:right">
            ${isCaissiere
              ? `<div style="display:inline-flex;align-items:center;gap:0;position:relative">
                   <input type="number" min="0" step="1000" value="${banque.solde_final||0}"
                     style="width:148px;text-align:right;padding:6px 44px 6px 10px;
                       border:1.5px solid var(--border);border-radius:8px;font-size:13px;
                       color:var(--accent-green);font-weight:600;background:#f0fff4;
                       outline:none;transition:border-color .15s,box-shadow .15s"
                     onfocus="this.style.borderColor='var(--accent)';this.style.boxShadow='0 0 0 3px rgba(59,130,246,0.12)';this.style.background='white'"
                     onblur="this.style.borderColor='var(--border)';this.style.boxShadow='none';this.style.background='#f0fff4'"
                     onchange="saveSoldeBanque(this.value)"/>
                   <span style="position:absolute;right:9px;font-size:11px;font-weight:600;
                     color:var(--text-muted);pointer-events:none">FCFA</span>
                 </div>`
              : `<span style="color:var(--accent-green);font-weight:600">${fmt(tr.solde_banque)}</span>`}
          </td></tr>
      </tbody>
      <tfoot><tr style="background:#f8fafc;font-weight:700">
        <td>TOTAL TRÉSORERIE</td><td style="text-align:right">${fmt(tr.total)}</td></tr></tfoot></table></div>

    ${buildBlocSelect(2,'Ressources Additionnelles Attendues','var(--accent-green)','res',s.ressources_attente,isCaissiere)}
    ${buildBlocSelect(3,'Dépenses en Attente','#744210','dep',s.depenses_attente,isCaissiere)}

    <div id="dispo-apres" style="background:${dispoApres>=0?'#f0fff4':'#fff5f5'};border:1px solid ${dispoApres>=0?'#9ae6b4':'#feb2b2'};
      border-radius:7px;padding:10px 14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <strong style="font-size:13px;color:var(--text-muted)">Trésorerie disponible (après ressources + dépenses en attente)</strong>
      <span style="font-size:18px;font-weight:700;color:${dispoApres>=0?'var(--accent-green)':'var(--accent-red)'}">${fmt(dispoApres)}</span>
    </div>

    <b style="color:var(--accent-green);display:block;margin-bottom:8px;font-size:13px">
      4. Prévision des Dépenses — Demande de Fonds pour ${s.mois_cible} ${s.annee_cible}</b>
    ${bloc4}`;
};

// Rechargement partiel : sections 2, 3 et trésorerie dispo uniquement
// (évite de refaire la section 1 et la section 4 qui n'ont pas changé)
window.reloadBlocsAttente=async()=>{
  const isCaissiere=['caissier','comptable_cabinet','directeur','super_admin'].includes(state.user?.role);
  const s=await api.get(`/appel-fonds/synthese?mois=${state.mois}&annee=${state.annee}`);
  if(!s||s.error)return;
  window._afSynthese=s;
  const el2=document.getElementById('bloc-att-res');
  const el3=document.getElementById('bloc-att-dep');
  if(el2) el2.outerHTML=buildBlocSelect(2,'Ressources Additionnelles Attendues','var(--accent-green)','res',s.ressources_attente,isCaissiere);
  if(el3) el3.outerHTML=buildBlocSelect(3,'Dépenses en Attente','#744210','dep',s.depenses_attente,isCaissiere);
  const d=s.tresorerie_apres_attente;
  const elD=document.getElementById('dispo-apres');
  if(elD){
    elD.style.background=d>=0?'#f0fff4':'#fff5f5';
    elD.style.borderColor=d>=0?'#9ae6b4':'#feb2b2';
    const sp=elD.querySelector('span');
    if(sp){sp.textContent=fmt(d);sp.style.color=d>=0?'var(--accent-green)':'var(--accent-red)';}
  }
};

// Pré-remplit l'intitulé quand on change la rubrique dans le SELECT
window.syncIntituleAF=(type)=>{
  const sel=$(`af-${type}-rub`);
  const intEl=$(`af-${type}-int`);
  if(!sel||!intEl)return;
  intEl.value=sel.options[sel.selectedIndex]?.dataset.int||'';
};
// Ajoute une ligne (POST) → rechargement partiel
window.addLigneAttente=async(type)=>{
  const sel=$(`af-${type}-rub`);
  const rub=sel?.value||'';
  if(!rub){toast('Sélectionnez une rubrique.','error');return;}
  const intitule=($(`af-${type}-int`).value||'').trim()||(sel.options[sel.selectedIndex]?.dataset.int||rub);
  const montant=parseFloat($(`af-${type}-mt`).value)||0;
  if(montant<=0){toast('Montant invalide.','error');return;}
  const path=type==='dep'?'/budget/depenses-attente':'/budget/ressources-attente';
  const res=await api.post(path,{mois:state.mois,annee:state.annee,rubrique_code:rub,intitule,montant});
  if(res.error){toast(res.error,'error');return;}
  toast('Ligne ajoutée ✓','success');
  await reloadBlocsAttente();
};
// Supprime une ligne (DELETE) → rechargement partiel
window.delLigneAttente=async(type,id)=>{
  if(!confirm('Supprimer cette ligne ?'))return;
  const path=type==='dep'?`/budget/depenses-attente/${id}`:`/budget/ressources-attente/${id}`;
  const res=await api.delete(path);
  if(res&&res.error){toast(res.error,'error');return;}
  toast('Ligne supprimée.','success');
  await reloadBlocsAttente();
};
window.saveSoldeBanque=async(v)=>{
  const montant=parseFloat(v)||0;
  const res=await api.put('/banque',{mois:state.mois,annee:state.annee,solde_final:montant});
  if(res.error){toast(res.error,'error');return;}
  toast('Solde banque enregistré ✓','success'); await loadAppelFonds();
};
window.statutDemande=async(statut)=>{
  const commentaire = statut==='valide' ? '' : (prompt('Commentaire (optionnel) :')||'');
  const res=await api.post('/budget/validation',{mois:state.mois,annee:state.annee,statut,commentaire});
  if(res.error){toast(res.error,'error');return;}
  toast(`Demande ${statut==='valide'?'approuvée':statut} ✓`,'success'); await loadAppelFonds();
};
window.imprimerDemande=()=>{
  const s=window._afSynthese; if(!s)return;
  const dateStr=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
  const tr=s.tresorerie;
  const lignesPrev=s.prevision.map(r=>`<tr><td><span class="badge">${r.rubrique_code}</span></td><td>${r.intitule}</td><td class="sol" style="text-align:right">${fmt(r.montant)}</td></tr>`).join('');
  const lignesRes=s.ressources_attente.map(r=>`<tr><td><span class="badge">${r.rubrique_code}</span></td><td>${r.intitule}</td><td class="ev" style="text-align:right">${fmt(r.montant)}</td></tr>`).join('');
  const lignesDep=s.depenses_attente.map(r=>`<tr><td><span class="badge">${r.rubrique_code}</span></td><td>${r.intitule}</td><td class="sv" style="text-align:right">${fmt(r.montant)}</td></tr>`).join('');
  const besoinBloc = s.besoin>0
    ? `<div class="resultat" style="border-color:#e53e3e;background:#fff5f5"><div class="rlabel">FONDS À DEMANDER POUR ${s.mois_cible} ${s.annee_cible}</div><div class="rval" style="color:#c53030">${fmt(s.besoin)}</div></div>`
    : `<div class="resultat" style="border-color:#38a169;background:#f0fff4"><div class="rlabel">TRÉSORERIE SUFFISANTE POUR ${s.mois_cible} ${s.annee_cible}</div><div class="rval" style="color:#276749">${fmt(s.excedent)}</div></div>`;
  const css=`*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;padding:20px;color:#1a202c}.ph{text-align:center;margin-bottom:20px;border-bottom:2px solid #1a365d;padding-bottom:12px}.ph h2{font-size:16px;color:#1a365d;margin-bottom:4px}h3{font-size:13px;color:#1a365d;margin:16px 0 6px}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}th{background:#1a365d;color:#fff;padding:7px 9px;text-align:left}th:last-child{text-align:right}td{padding:6px 9px;border-bottom:1px solid #e2e8f0}.ev{color:#276749;font-weight:600}.sv{color:#c53030;font-weight:600}.sol{color:#1a365d;font-weight:700}.badge{background:#ebf4ff;color:#1a365d;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700}.tot td{background:#edf2f7;font-weight:700}.resultat{border:2px solid;border-radius:8px;padding:14px;text-align:center;margin-top:14px}.rlabel{font-size:11px;font-weight:700;color:#718096;text-transform:uppercase}.rval{font-size:24px;font-weight:700;margin-top:4px}.sig{margin-top:40px;display:flex;justify-content:space-between}.sig div{text-align:center;font-size:11px;width:45%}.sig .line{border-top:1px solid #1a202c;margin-top:40px;padding-top:4px}@media print{@page{size:A4;margin:15mm}}`;
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Demande de Fonds — ${s.mois_cible} ${s.annee_cible}</title><style>${css}</style></head><body>
    <div class="ph"><h2>DEMANDE DE FONDS</h2><p>Pour la période : <b>${s.mois_cible} ${s.annee_cible}</b></p><p>Imprimé le : ${dateStr}</p></div>
    <h3>1. Trésorerie Actuelle (${s.mois} ${s.annee})</h3>
    <table><tbody>
      <tr><td>Solde caisse espèces</td><td class="ev" style="text-align:right">${fmt(tr.solde_espece)}</td></tr>
      <tr><td>Solde caisse OM</td><td class="ev" style="text-align:right">${fmt(tr.solde_om)}</td></tr>
      <tr><td>Solde final en banque</td><td class="ev" style="text-align:right">${fmt(tr.solde_banque)}</td></tr>
      <tr class="tot"><td>TOTAL TRÉSORERIE</td><td class="sol" style="text-align:right">${fmt(tr.total)}</td></tr></tbody></table>
    ${s.ressources_attente.length?`<h3>2. Ressources Additionnelles Attendues</h3><table><tbody>${lignesRes}<tr class="tot"><td colspan="2">TOTAL RESSOURCES</td><td class="ev" style="text-align:right">${fmt(s.total_ressources)}</td></tr></tbody></table>`:''}
    ${s.depenses_attente.length?`<h3>3. Dépenses en Attente</h3><table><tbody>${lignesDep}<tr class="tot"><td colspan="2">TOTAL EN ATTENTE</td><td class="sol" style="text-align:right">${fmt(s.total_attente)}</td></tr></tbody></table>`:''}
    <h3>4. Prévision des Dépenses — ${s.mois_cible} ${s.annee_cible}</h3>
    <table><thead><tr><th>Rubrique</th><th>Intitulé</th><th>Montant prévisionnel</th></tr></thead><tbody>${lignesPrev}<tr class="tot"><td colspan="2">TOTAL PRÉVISIONNEL</td><td class="sol" style="text-align:right">${fmt(s.total_prevision)}</td></tr></tbody></table>
    ${besoinBloc}
    <div class="sig"><div><div class="line">La Caissière</div></div><div><div class="line">Le Directeur (Approbation)</div></div></div>
    </body></html>`;
  const blob=new Blob([html],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const w=window.open(url,'_blank');
  if(w){w.onload=()=>{setTimeout(()=>w.print(),300);};}
  setTimeout(()=>URL.revokeObjectURL(url),10000);
};

// ── COMPTE D'EMPLOI ───────────────────────────────────────────────────────
const CE_TYPE_LABEL = {
  caisse:         'Caisse Espèces',
  om:             'Orange Money',
  momo:           'Mobile Money',
  carte_prepayee: 'Carte Prépayée',
  autre:          'Autre',
};
const CE_TYPE_ICO = {
  caisse:'💵', om:'📱', momo:'📲', carte_prepayee:'💳', autre:'🏦',
};

const loadCompteEmploi = async () => {
  const container=$('compte-emploi-content');
  const isAdmin=['super_admin','comptable_cabinet'].includes(state.user?.role);
  if(isAdmin&&!(state.activeTenantId||state.user?.tenantId)){
    container.innerHTML=`
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
        min-height:320px;background:white;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,.07);
        border:1px solid var(--border);gap:16px">
        <div style="width:64px;height:64px;background:linear-gradient(135deg,#dbeafe,#eff6ff);border-radius:16px;
          display:flex;align-items:center;justify-content:center;font-size:28px">🏢</div>
        <div style="text-align:center">
          <h3 style="font-size:16px;font-weight:700;margin-bottom:4px">Sélectionnez un client</h3>
          <p style="font-size:13px;color:var(--text-muted)">Choisissez le client pour générer son compte d'emploi</p>
        </div>
        <button class="btn-primary" style="width:auto;padding:10px 24px" onclick="showTenantSelector()">
          Choisir un client
        </button>
      </div>`;
    return;
  }

  container.innerHTML=`
    <div style="display:flex;align-items:center;gap:12px;padding:16px 20px;
      background:white;border-radius:12px;border:1px solid var(--border);margin-bottom:16px">
      <div style="width:36px;height:36px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);border-radius:10px;
        display:flex;align-items:center;justify-content:center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
      </div>
      <div>
        <div style="font-weight:700;font-size:14px">Compte d'Emploi</div>
        <div style="font-size:12px;color:var(--text-muted)">${state.mois} ${state.annee} — calcul en cours…</div>
      </div>
      <div class="spinner" style="margin-left:auto"></div>
    </div>`;

  const data=await api.get(`/rapport/compte-emploi?mois=${state.mois}&annee=${state.annee}`);
  if(data.error){container.innerHTML=`<div class="alert-err">${data.error}</div>`;return;}

  const {meta,ressources,emplois,tresorerie_finale,solde_net}=data;
  const fmtM = v => fmt(v, meta.devise);
  const txUtilisation = ressources.total > 0 ? Math.round(emplois.total / ressources.total * 100) : 0;
  const jTypeLabel = t => CE_TYPE_LABEL[t] || t;
  const jTypeIco   = t => CE_TYPE_ICO[t]   || '💼';

  // ── Section I helpers ──────────────────────────────────────────────────────
  const mkResRow = (ico, label, montant, sub='') => montant === 0 ? '' : `
    <tr class="ce-res-row">
      <td style="padding:9px 16px;display:flex;align-items:center;gap:10px">
        <span style="font-size:15px;flex-shrink:0">${ico}</span>
        <span>
          <span style="font-weight:500;color:var(--text)">${label}</span>
          ${sub?`<span style="font-size:11px;color:var(--text-muted);display:block;margin-top:1px">${sub}</span>`:''}
        </span>
      </td>
      <td style="padding:9px 16px;text-align:right;font-weight:600;color:#059669;font-size:13px">${fmtM(montant)}</td>
    </tr>`;

  const ranLignes = (ressources.journaux||[])
    .filter(j => j.ran > 0)
    .map(j => mkResRow(jTypeIco(j.journal_type), j.journal_nom, j.ran, `Solde initial (RAN) · ${jTypeLabel(j.journal_type)}`))
    .join('');

  const ranBanqueRow = ressources.solde_banque_initial > 0
    ? mkResRow('🏦','Banque', ressources.solde_banque_initial, 'Solde initial (mois précédent)')
    : '';

  const fondsLignes = (ressources.journaux||[])
    .filter(j => j.fonds_recus > 0)
    .map(j => mkResRow(jTypeIco(j.journal_type), j.journal_nom, j.fonds_recus, `Fonds reçus · ${jTypeLabel(j.journal_type)}`))
    .join('');

  const fondsBanqueRow = ressources.fonds_recus_banque > 0
    ? mkResRow('🏦','Banque', ressources.fonds_recus_banque, 'Fonds reçus en banque')
    : '';

  // ── Section II — Emplois avec mini barre de progression ───────────────────
  const emploisTriees = [...(emplois.lignes||[])].sort((a,b)=>b.total-a.total);
  const maxEmploi = emploisTriees[0]?.total || 1;

  const emploisLignes = emploisTriees.map((e,i) => {
    const pct = Math.round(e.total / emplois.total * 100);
    const barW = Math.round(e.total / maxEmploi * 100);
    const barColor = pct > 30 ? '#ef4444' : pct > 15 ? '#f97316' : '#fb923c';
    return `
    <tr class="ce-emp-row" style="cursor:pointer"
        data-code="${e.rubrique_code}"
        data-intitule="${(e.intitule||'').replace(/"/g,'&quot;')}"
        data-esp="${e.esp}" data-om="${e.om}" data-total="${e.total}"
        onclick="showCEEmploiDetail(this)">
      <td style="padding:10px 16px;width:52px">
        <span style="display:inline-flex;align-items:center;justify-content:center;
          width:32px;height:24px;background:#fff1f2;border:1px solid #fecdd3;
          border-radius:6px;font-size:11px;font-weight:700;color:#dc2626">${e.rubrique_code}</span>
      </td>
      <td style="padding:10px 4px">
        <div style="font-weight:500;color:var(--text);font-size:13px">${e.intitule}</div>
        <div style="margin-top:4px;display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:4px;background:#f1f5f9;border-radius:2px;max-width:160px">
            <div style="width:${barW}%;height:100%;background:${barColor};border-radius:2px"></div>
          </div>
          <span style="font-size:10px;color:var(--text-muted);white-space:nowrap">${pct}% du total</span>
        </div>
      </td>
      <td style="padding:10px 16px;text-align:right;color:#9a3412;font-size:12px">${e.esp>0?fmtM(e.esp):'—'}</td>
      <td style="padding:10px 16px;text-align:right;color:#9a3412;font-size:12px">${e.om>0?fmtM(e.om):'—'}</td>
      <td style="padding:10px 16px;text-align:right;font-weight:700;color:#dc2626;white-space:nowrap">
        ${fmtM(e.total)}
        <svg style="margin-left:4px;opacity:.4;vertical-align:middle" width="11" height="11"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </td>
    </tr>`;
  }).join('');

  // ── Section III ────────────────────────────────────────────────────────────
  const tresFinale = solde_net;
  const ecart = tresorerie_finale.ecart !== undefined
    ? tresorerie_finale.ecart
    : (tresFinale - tresorerie_finale.disponible);
  const ecartOk = Math.abs(ecart) < 1;

  const tresoLignes = (tresorerie_finale.journaux||[]).map(j => {
    const sf = j.solde_final;
    const pos = sf >= 0;
    return `<tr class="ce-res-row">
      <td style="padding:8px 16px 8px 36px;display:flex;align-items:center;gap:8px">
        <span style="font-size:13px">${jTypeIco(j.journal_type)}</span>
        <span>
          <span style="font-size:12px;color:var(--text-muted)">dont</span>
          <strong style="margin-left:4px;color:var(--text)">${j.journal_nom}</strong>
          <span style="font-size:11px;color:var(--text-muted);margin-left:4px">(${jTypeLabel(j.journal_type)})</span>
        </span>
      </td>
      <td style="padding:8px 16px;text-align:right;font-weight:600;font-size:13px;
        color:${pos?'#1d4ed8':'#dc2626'}">${fmtM(sf)}</td>
    </tr>`;
  }).join('');

  const banqueSF = tresorerie_finale.solde_banque || 0;
  const tresoLigneBanque = `<tr class="ce-res-row">
    <td style="padding:8px 16px 8px 36px;display:flex;align-items:center;gap:8px">
      <span style="font-size:13px">🏦</span>
      <span>
        <span style="font-size:12px;color:var(--text-muted)">dont</span>
        <strong style="margin-left:4px;color:var(--text)">Banque</strong>
        <span style="font-size:11px;color:var(--text-muted);margin-left:4px">(Compte bancaire)</span>
      </span>
    </td>
    <td style="padding:8px 16px;text-align:right;font-weight:600;font-size:13px;
      color:${banqueSF>=0?'#1d4ed8':'#dc2626'}">${fmtM(banqueSF)}</td>
  </tr>`;

  // ── Rendu final ────────────────────────────────────────────────────────────
  container.innerHTML=`
  <style>
    .ce-res-row:hover{background:#f8fafc}
    .ce-res-row td{border-bottom:1px solid #f1f5f9;transition:background .15s}
    .ce-emp-row:hover{background:#fff5f5}
    .ce-emp-row td{border-bottom:1px solid #fff1f2;transition:background .15s}
    .ce-section{background:white;border-radius:14px;border:1px solid var(--border);
      overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,.06);margin-bottom:14px}
    .ce-section-head{display:flex;align-items:center;gap:12px;padding:14px 18px;
      border-bottom:1px solid var(--border)}
    .ce-num{width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;
      justify-content:center;font-size:12px;font-weight:800;flex-shrink:0}
    .ce-subtit{padding:7px 16px;font-size:10.5px;font-weight:700;text-transform:uppercase;
      letter-spacing:.6px;border-bottom:1px solid var(--border)}
  </style>

  <div style="max-width:860px">

    <!-- ── Barre de titre ──────────────────────────────────────────────── -->
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;flex-wrap:wrap">
      <div style="flex:1">
        ${isAdmin?`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:11px;padding:3px 10px;background:#dbeafe;color:#1d4ed8;
            border-radius:20px;font-weight:700">${meta.tenant_nom}</span>
          <button onclick="showTenantSelector()" style="font-size:11px;background:none;border:1px solid var(--border);
            border-radius:6px;padding:2px 8px;cursor:pointer;color:var(--text-muted)">Changer</button>
        </div>`:''}
        <h2 style="font-size:20px;font-weight:800;margin:0;color:var(--text)">Compte d'Emploi</h2>
        <p style="margin:2px 0 0;font-size:13px;color:var(--text-muted)">
          Période : <strong>${meta.mois} ${meta.annee}</strong>
          ${meta.directeur_nom?`&nbsp;·&nbsp;Dir. : <strong>${meta.directeur_nom}</strong>`:''}
          ${meta.caissier_nom?`&nbsp;·&nbsp;Caissier : <strong>${meta.caissier_nom}</strong>`:''}
        </p>
      </div>
      <button onclick="loadCompteEmploi()" style="display:inline-flex;align-items:center;gap:6px;
        background:white;border:1px solid var(--border);border-radius:10px;padding:8px 14px;
        font-size:13px;font-weight:600;cursor:pointer;color:var(--text);transition:all .2s"
        onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>Actualiser
      </button>
      <button onclick="printCE()" style="display:inline-flex;align-items:center;gap:6px;
        background:linear-gradient(135deg,#2563eb,#1d4ed8);border:none;border-radius:10px;
        padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer;color:white;
        box-shadow:0 2px 8px rgba(37,99,235,.35)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 6 2 18 2 18 9"/>
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
          <rect x="6" y="14" width="12" height="8"/>
        </svg>Imprimer
      </button>
    </div>

    <!-- ── KPI Cards ───────────────────────────────────────────────────── -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">
      <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #bbf7d0;
        border-radius:14px;padding:16px 18px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
          color:#16a34a;margin-bottom:6px">Ressources</div>
        <div style="font-size:18px;font-weight:800;color:#15803d;line-height:1.1">${fmtM(ressources.total)}</div>
        <div style="font-size:11px;color:#4ade80;margin-top:4px">Total mobilisé</div>
      </div>
      <div style="background:linear-gradient(135deg,#fff1f2,#fee2e2);border:1px solid #fecaca;
        border-radius:14px;padding:16px 18px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
          color:#dc2626;margin-bottom:6px">Emplois</div>
        <div style="font-size:18px;font-weight:800;color:#b91c1c;line-height:1.1">${fmtM(emplois.total)}</div>
        <div style="font-size:11px;color:#f87171;margin-top:4px">${emplois.lignes?.length||0} rubrique${(emplois.lignes?.length||0)>1?'s':''}</div>
      </div>
      <div style="background:linear-gradient(135deg,#fdf4ff,#f3e8ff);border:1px solid #e9d5ff;
        border-radius:14px;padding:16px 18px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
          color:#7c3aed;margin-bottom:6px">Taux d'utilisation</div>
        <div style="font-size:18px;font-weight:800;color:${txUtilisation>90?'#dc2626':txUtilisation>70?'#d97706':'#7c3aed'};line-height:1.1">${txUtilisation}%</div>
        <div style="margin-top:6px;height:4px;background:#e9d5ff;border-radius:2px;overflow:hidden">
          <div style="width:${Math.min(txUtilisation,100)}%;height:100%;
            background:${txUtilisation>90?'#ef4444':txUtilisation>70?'#f59e0b':'#a855f7'};border-radius:2px"></div>
        </div>
      </div>
      <div style="background:linear-gradient(135deg,${solde_net>=0?'#f0fdf4,#dcfce7':'#fff1f2,#fee2e2'});
        border:1px solid ${solde_net>=0?'#bbf7d0':'#fecaca'};border-radius:14px;padding:16px 18px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
          color:${solde_net>=0?'#16a34a':'#dc2626'};margin-bottom:6px">${solde_net>=0?'Excédent':'Déficit'}</div>
        <div style="font-size:18px;font-weight:800;color:${solde_net>=0?'#15803d':'#b91c1c'};line-height:1.1">${fmtM(Math.abs(solde_net))}</div>
        <div style="font-size:11px;color:${solde_net>=0?'#4ade80':'#f87171'};margin-top:4px">
          Ressources − Emplois</div>
      </div>
    </div>

    <!-- ═══════════════ DOCUMENT IMPRIMABLE ═════════════════════════════ -->
    <div id="ce-printable">

      <!-- ── I. RESSOURCES ──────────────────────────────────────────── -->
      <div class="ce-section">
        <div class="ce-section-head" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7)">
          <span class="ce-num" style="background:#16a34a;color:white">I</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:.5px">Ressources</div>
            <div style="font-size:11px;color:#4ade80;margin-top:1px">Soldes initiaux + Fonds reçus</div>
          </div>
          <div style="margin-left:auto;font-size:16px;font-weight:800;color:#15803d">${fmtM(ressources.total)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tbody>
            <tr class="ce-subtit" style="background:#f0fdf4;color:#16a34a">
              <td colspan="2">📊 Soldes initiaux — Report à Nouveau (RAN)</td>
            </tr>
            ${ranLignes||`<tr class="ce-res-row"><td style="padding:9px 16px;color:var(--text-muted);font-style:italic" colspan="2">Aucun solde initial enregistré</td></tr>`}
            ${ranBanqueRow}
            <tr class="ce-subtit" style="background:#f0fdf4;color:#16a34a">
              <td colspan="2">💰 Fonds reçus ce mois</td>
            </tr>
            ${fondsLignes||`<tr class="ce-res-row"><td style="padding:9px 16px;color:var(--text-muted);font-style:italic" colspan="2">Aucun fonds reçu ce mois</td></tr>`}
            ${fondsBanqueRow}
          </tbody>
          <tfoot>
            <tr style="background:linear-gradient(135deg,#f0fdf4,#dcfce7)">
              <td style="padding:12px 16px;font-weight:700;font-size:13px;color:#15803d;
                border-top:2px solid #86efac;letter-spacing:.3px">TOTAL RESSOURCES</td>
              <td style="padding:12px 16px;text-align:right;font-weight:800;font-size:16px;
                color:#15803d;border-top:2px solid #86efac">${fmtM(ressources.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- ── II. EMPLOIS ────────────────────────────────────────────── -->
      <div class="ce-section">
        <div class="ce-section-head" style="background:linear-gradient(135deg,#fff1f2,#fee2e2)">
          <span class="ce-num" style="background:#dc2626;color:white">II</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:#b91c1c;text-transform:uppercase;letter-spacing:.5px">Emplois</div>
            <div style="font-size:11px;color:#f87171;margin-top:1px">Journal de dépenses — cliquez pour voir le détail</div>
          </div>
          <div style="margin-left:auto;font-size:16px;font-weight:800;color:#b91c1c">${fmtM(emplois.total)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#fff8f8">
              <th style="padding:8px 16px;text-align:left;border-bottom:1px solid #fecaca;
                font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;width:52px">Code</th>
              <th style="padding:8px 4px;text-align:left;border-bottom:1px solid #fecaca;
                font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase">Rubrique</th>
              <th style="padding:8px 16px;text-align:right;border-bottom:1px solid #fecaca;
                font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase">Espèces</th>
              <th style="padding:8px 16px;text-align:right;border-bottom:1px solid #fecaca;
                font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase">MM</th>
              <th style="padding:8px 16px;text-align:right;border-bottom:1px solid #fecaca;
                font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase">Total</th>
            </tr>
          </thead>
          <tbody>
            ${emploisLignes||`<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px">
              Aucune dépense enregistrée ce mois.</td></tr>`}
          </tbody>
          <tfoot>
            <tr style="background:linear-gradient(135deg,#fff1f2,#fee2e2)">
              <td colspan="4" style="padding:12px 16px;font-weight:700;font-size:13px;color:#b91c1c;
                border-top:2px solid #fca5a5;letter-spacing:.3px">TOTAL EMPLOIS</td>
              <td style="padding:12px 16px;text-align:right;font-weight:800;font-size:16px;
                color:#b91c1c;border-top:2px solid #fca5a5">${fmtM(emplois.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- ── III. TRÉSORERIE FINALE ─────────────────────────────────── -->
      <div class="ce-section">
        <div class="ce-section-head" style="background:linear-gradient(135deg,#eff6ff,#dbeafe)">
          <span class="ce-num" style="background:#1d4ed8;color:white;font-size:10px">III</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.5px">Trésorerie Finale &amp; Soldes</div>
            <div style="font-size:11px;color:#93c5fd;margin-top:1px">Ressources − Emplois et ventilation par compte</div>
          </div>
          <div style="margin-left:auto;font-size:16px;font-weight:800;color:${tresFinale>=0?'#1d4ed8':'#dc2626'}">${fmtM(tresFinale)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tbody>
            <!-- Ligne principale : Trésorerie = Ressources - Emplois -->
            <tr style="background:linear-gradient(135deg,#eff6ff,#dbeafe)">
              <td style="padding:13px 16px;font-weight:700;font-size:13px;color:#1e40af;
                border-bottom:2px solid #bfdbfe;letter-spacing:.2px">
                ⚖️ Trésorerie Finale &nbsp;
                <span style="font-size:11px;font-weight:500;color:#60a5fa">(Ressources − Emplois)</span>
              </td>
              <td style="padding:13px 16px;text-align:right;font-weight:800;font-size:16px;
                color:${tresFinale>=0?'#1d4ed8':'#dc2626'};border-bottom:2px solid #bfdbfe">${fmtM(tresFinale)}</td>
            </tr>
            <!-- Dont : soldes par journal (tous, même si 0) -->
            ${tresoLignes}
            <!-- Dont : banque (toujours) -->
            ${tresoLigneBanque}
          </tbody>
          <tfoot>
            <tr style="background:${ecartOk?'linear-gradient(135deg,#f0fdf4,#dcfce7)':'linear-gradient(135deg,#fffbeb,#fef3c7)'};
              border-top:2px solid ${ecartOk?'#86efac':'#fcd34d'}">
              <td style="padding:12px 16px;font-weight:700;color:${ecartOk?'#15803d':'#92400e'}">
                ${ecartOk?'✅':'⚠️'} Écart &nbsp;
                <span style="font-size:11px;font-weight:500">(Trésorerie − Σ Soldes des comptes)</span>
              </td>
              <td style="padding:12px 16px;text-align:right;font-weight:800;font-size:15px;
                color:${ecartOk?'#15803d':'#b45309'}">
                ${ecart>=0?'+':''}${fmtM(ecart)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- ── Pied de page document ──────────────────────────────────── -->
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:14px 18px;background:white;border-radius:12px;border:1px solid var(--border);
        font-size:11px;color:var(--text-muted);margin-top:4px">
        <span>Édité le ${new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}</span>
        <span style="display:flex;align-items:center;gap:6px">
          <span style="width:6px;height:6px;background:#2563eb;border-radius:50%;display:inline-block"></span>
          CaissePro v2
        </span>
      </div>

    </div><!-- /ce-printable -->
  </div>`;
};

// Détail emploi — mouvements du journal pour une rubrique
window.showCEEmploiDetail = async (tr) => {
  const code = tr.dataset.code;
  const intitule = tr.dataset.intitule;
  const esp   = parseFloat(tr.dataset.esp)   || 0;
  const om    = parseFloat(tr.dataset.om)    || 0;
  const total = parseFloat(tr.dataset.total) || 0;

  const mid = 'modal-ce-emploi-detail';
  const existing = document.getElementById(mid);
  if (existing) existing.remove();

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="${mid}" onclick="if(event.target===this)closeCEEmploiDetail()">
      <div class="modal-box" style="max-width:760px">
        <div class="modal-head">
          <h3><span class="badge-rubrique" style="font-size:12px">${code}</span>&nbsp;${intitule}</h3>
          <button class="modal-close" onclick="closeCEEmploiDetail()">✕</button>
        </div>
        <div class="modal-body">
          <!-- KPIs -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
            <div style="background:#f8fafc;border:1px solid var(--border);border-radius:10px;padding:14px 16px">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:6px">Espèces</div>
              <div style="font-size:18px;font-weight:700;color:#991b1b">${fmt(esp)}</div>
            </div>
            <div style="background:#f8fafc;border:1px solid var(--border);border-radius:10px;padding:14px 16px">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:6px">Mobile Money</div>
              <div style="font-size:18px;font-weight:700;color:#991b1b">${fmt(om)}</div>
            </div>
            <div style="background:#fff1f2;border:1px solid #fca5a5;border-radius:10px;padding:14px 16px">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#991b1b;margin-bottom:6px">Total dépensé</div>
              <div style="font-size:20px;font-weight:800;color:#991b1b">${fmt(total)}</div>
            </div>
          </div>
          <div class="form-section" style="margin-top:0">Mouvements — ${state.mois} ${state.annee}</div>
          <div id="ce-emploi-mvt-table" style="margin-top:12px">
            <div style="text-align:center;padding:24px;color:var(--text-muted)">
              <div class="spinner spinner-lg" style="margin:0 auto 10px"></div>
              Chargement des mouvements…
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn-ghost" onclick="closeCEEmploiDetail()">Fermer</button>
        </div>
      </div>
    </div>`);

  const data = await api.get(
    `/journal?mois=${state.mois}&annee=${state.annee}&rubrique_code=${encodeURIComponent(code)}`
  );
  const mvts = (data && data.mouvements) || [];
  const tbl  = document.getElementById('ce-emploi-mvt-table');
  if (!tbl) return;

  if (!mvts.length) {
    tbl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px">
      Aucun mouvement enregistré pour cette rubrique ce mois-ci.</div>`;
    return;
  }

  const lignes = mvts.map(m => {
    const sortie  = parseFloat(m.sortie  || 0);
    const entree  = parseFloat(m.entree  || 0);
    const montant = sortie || entree;
    const isSortie = sortie > 0;
    const journalLabel = m.journal_nom || m.journal_code || '—';
    const dateStr = m.date
      ? new Date(m.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})
      : '—';
    return `<tr>
      <td style="white-space:nowrap">${dateStr}</td>
      <td><span style="font-size:11px;background:#eff6ff;color:#1d4ed8;padding:2px 7px;border-radius:4px;font-weight:600">${journalLabel}</span></td>
      <td>${m.type_caisse==='especes'
        ? '<span style="font-size:10px;background:#dcfce7;color:#166534;padding:2px 6px;border-radius:3px">Espèces</span>'
        : '<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:3px">Mobile Money</span>'}</td>
      <td>${m.intitule||'—'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${m.beneficiaire||m.objet||''}</td>
      <td style="text-align:right;font-weight:600;color:${isSortie?'var(--accent-red)':'var(--accent-green)'}">
        ${isSortie?'-':'+'} ${fmt(montant)}</td>
    </tr>`;
  }).join('');

  const totalSorties = mvts.reduce((s,m)=>s+parseFloat(m.sortie||0),0);

  tbl.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Date</th><th>Journal</th><th>Caisse</th>
          <th>Intitulé</th><th>Bénéficiaire / Objet</th>
          <th style="text-align:right">Montant</th>
        </tr></thead>
        <tbody>${lignes}</tbody>
        <tfoot><tr style="background:#f8fafc;font-weight:700">
          <td colspan="5">TOTAL (${mvts.length} mouvement${mvts.length>1?'s':''})</td>
          <td style="text-align:right;color:var(--accent-red)">${fmt(totalSorties)}</td>
        </tr></tfoot>
      </table>
    </div>`;
};

window.closeCEEmploiDetail = () => {
  const m = document.getElementById('modal-ce-emploi-detail');
  if (m) m.remove();
};

window.printCE=()=>{
  const c=$('ce-printable'); if(!c)return;
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Compte d'Emploi — CaissePro</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#1a1a1a;
        background:white;padding:18mm 16mm}
      .ce-section{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:14px}
      .ce-section-head{display:flex;align-items:center;gap:10px;padding:10px 14px}
      .ce-section-head.green{background:#f0fdf4;border-bottom:1px solid #bbf7d0}
      .ce-section-head.red{background:#fff1f2;border-bottom:1px solid #fecaca}
      .ce-section-head.blue{background:#eff6ff;border-bottom:1px solid #bfdbfe}
      .ce-num{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;
        justify-content:center;font-size:10px;font-weight:800;flex-shrink:0}
      .sec-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
      .sec-total{margin-left:auto;font-size:14px;font-weight:800}
      .ce-subtit{padding:5px 14px;font-size:9.5px;font-weight:700;text-transform:uppercase;
        letter-spacing:.5px;background:#f8fafc;color:#6b7280;border-bottom:1px solid #f1f5f9}
      table{width:100%;border-collapse:collapse}
      td,th{padding:6px 14px;font-size:11px}
      th{background:#f8fafc;font-weight:600;color:#6b7280;font-size:10px;
        text-transform:uppercase;letter-spacing:.3px;border-bottom:1px solid #e2e8f0}
      .ce-res-row td,.ce-emp-row td{border-bottom:1px solid #f9fafb}
      tfoot td{font-weight:700;border-top:2px solid #e2e8f0}
      .print-head{text-align:center;padding-bottom:16px;margin-bottom:18px;
        border-bottom:3px solid #2563eb}
      button,.ce-emp-row svg{display:none!important}
      .ce-emp-row td:last-child::after{content:none}
      /* Remove progress bars in print */
      [style*="height:4px"]{display:none}
      /* Remove hover indicators */
      [style*="opacity:.4"]{display:none}
    </style></head>
    <body>
      <div class="print-head">
        <h1 style="font-size:16px;font-weight:800;color:#2563eb;text-transform:uppercase;
          letter-spacing:1px;margin-bottom:4px">COMPTE D'EMPLOI</h1>
        <p style="font-size:13px;font-weight:600;color:#374151">
          ${c.querySelector('.ce-section-head')?.closest('[id="ce-printable"]')?.previousElementSibling?.textContent?.trim() || ''}
        </p>
      </div>
      ${c.innerHTML.replace(/▶ détail/g,'').replace(/class="spinner[^"]*"/g,'').replace(/class="loading-msg"/g,'')}
      <script>window.onload=()=>window.print();<\/script>
    </body></html>`);
  w.document.close();
};

// ── CONFIGURATION (6 onglets) ─────────────────────────────────────────────
const loadConfig = async () => {
  const container=$('config-content');
  const isSuperAdmin = state.user?.role === 'super_admin';
  container.innerHTML=`
    <div class="tabs-header">
      <button class="tab-btn active" onclick="switchTab('tab-entite',this)">🏢 Entité</button>
      <button class="tab-btn" onclick="switchTab('tab-users',this)">👥 Utilisateurs</button>
      <button class="tab-btn" onclick="switchTab('tab-journaux',this)">📒 Journaux</button>
      <button class="tab-btn" onclick="switchTab('tab-plan',this)">📚 Plan comptable</button>
      <button class="tab-btn" onclick="switchTab('tab-rubriques',this)">📋 Rubriques</button>
      <button class="tab-btn" onclick="switchTab('tab-pieces',this)">📎 Pièces justificatives</button>
      ${isSuperAdmin ? `<button class="tab-btn" onclick="switchTab('tab-roles',this)" style="color:#7c3aed">🎭 Rôles</button>` : ''}
    </div>
    <div id="tab-entite"    class="tab-content active"><div class="loading-msg">Chargement…</div></div>
    <div id="tab-users"     class="tab-content" style="display:none"><div class="loading-msg">Chargement…</div></div>
    <div id="tab-journaux"  class="tab-content" style="display:none"><div class="loading-msg">Chargement…</div></div>
    <div id="tab-plan"      class="tab-content" style="display:none"><div class="loading-msg">Chargement…</div></div>
    <div id="tab-rubriques" class="tab-content" style="display:none"><div class="loading-msg">Chargement…</div></div>
    <div id="tab-pieces"    class="tab-content" style="display:none"><div class="loading-msg">Chargement…</div></div>
    ${isSuperAdmin ? `<div id="tab-roles" class="tab-content" style="display:none"><div class="loading-msg">Chargement…</div></div>` : ''}`;
  await loadTabEntite();
};

window.switchTab=(tabId,btn)=>{
  document.querySelectorAll('.tab-content').forEach(t=>t.style.display='none');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  const tab=$(tabId); if(tab)tab.style.display='block';
  btn.classList.add('active');
  if(tabId==='tab-entite')    loadTabEntite();
  if(tabId==='tab-users')     loadTabUsers();
  if(tabId==='tab-journaux')  loadTabJournaux();
  if(tabId==='tab-plan')      loadTabPlan();
  if(tabId==='tab-rubriques') loadTabRubriques();
  if(tabId==='tab-pieces')    loadTabPieces();
  if(tabId==='tab-roles')     loadTabRoles();
};

// ── Tab Plan Comptable SYSCOHADA (consultation) ───────────────────────────
// Cache au niveau onglet : on charge une seule fois la liste complète,
// puis on filtre côté client (rapide, pas de requête à chaque touche).
const _planState = { all: [], classes: [], stats: null, currentClasse: null, currentQuery: '' };

const loadTabPlan = async () => {
  const container = $('tab-plan'); if(!container) return;

  // Si déjà chargé, on rerend juste depuis le cache
  if(_planState.all.length > 0){ renderTabPlan(); return; }

  container.innerHTML = `<div class="loading-msg">Chargement du plan comptable SYSCOHADA…</div>`;

  const [listRes, classesRes, statsRes] = await Promise.all([
    api.get('/plan-comptable/list?limit=2000'),
    api.get('/plan-comptable/classes'),
    api.get('/plan-comptable/stats'),
  ]);

  if(listRes?.error && (!listRes.comptes || listRes.comptes.length === 0)){
    container.innerHTML = `
      <div style="background:white;border:1px solid var(--border);border-radius:12px;padding:32px;text-align:center">
        <div style="font-size:40px;margin-bottom:12px">📚</div>
        <h3 style="font-size:15px;font-weight:700;margin-bottom:8px">Plan comptable non chargé</h3>
        <p style="color:var(--text-muted);font-size:13px">
          La table <code>plan_comptable_syscohada</code> est vide ou inexistante en base.<br>
          Contactez l'administrateur pour charger le référentiel SYSCOHADA révisé.
        </p>
      </div>`;
    return;
  }

  _planState.all     = listRes?.comptes || [];
  _planState.classes = Array.isArray(classesRes) ? classesRes : [];
  _planState.stats   = statsRes || { par_classe: [], total: 0 };

  renderTabPlan();
};

// Rendu (re-)appelé sans recharger les données
const renderTabPlan = () => {
  const container = $('tab-plan'); if(!container) return;
  const { all, classes, stats, currentClasse, currentQuery } = _planState;

  // Carte de classe sélectionnable
  const nbByClasse = Object.fromEntries((stats?.par_classe || []).map(s => [s.classe, s.nb]));
  const classCards = classes.map(c => `
    <button onclick="filterPlanByClasse(${c.id})"
      class="plan-class-btn ${currentClasse === c.id ? 'active' : ''}"
      style="background:${currentClasse === c.id ? 'var(--accent-purple,#7c3aed)' : 'white'};
             color:${currentClasse === c.id ? 'white' : 'var(--text)'};
             border:1.5px solid ${currentClasse === c.id ? 'var(--accent-purple,#7c3aed)' : 'var(--border)'};
             padding:10px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;
             display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:140px;text-align:left">
      <span>Classe ${c.id}</span>
      <span style="font-size:10px;font-weight:500;opacity:.8">${c.label.replace(/^Classe \d+ — /,'')}</span>
      <span style="font-size:10px;font-weight:700;margin-top:2px">${nbByClasse[c.id] || 0} comptes</span>
    </button>`).join('');

  // Filtrage côté client
  let filtered = all;
  if(currentClasse !== null){
    filtered = filtered.filter(c => c.classe === currentClasse);
  }
  if(currentQuery && currentQuery.length >= 1){
    const q = currentQuery.toLowerCase();
    filtered = filtered.filter(c =>
      c.compte.toLowerCase().includes(q) ||
      (c.intitule || '').toLowerCase().includes(q)
    );
  }

  // Tableau (avec virtualisation simple : on coupe à 500 lignes max)
  const MAX_DISPLAY = 500;
  const displayed = filtered.slice(0, MAX_DISPLAY);
  const truncated = filtered.length > MAX_DISPLAY;

  const canEditRows = ['directeur','super_admin','comptable_cabinet'].includes(state.user?.role);
  const rows = displayed.length === 0
    ? `<tr><td colspan="${canEditRows?6:5}" style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px">
         Aucun compte ne correspond aux critères.
       </td></tr>`
    : displayed.map(c => {
        const isCustom = c.source === 'custom';
        return `
        <tr style="border-bottom:1px solid #f1f5f9;transition:background .1s${isCustom ? ';background:#faf5ff' : ''}"
          onmouseover="this.style.background='${isCustom ? '#f3e8ff' : '#f8fafc'}'"
          onmouseout="this.style.background='${isCustom ? '#faf5ff' : ''}'">
          <td style="padding:10px 16px">
            <span style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;
              color:${isCustom ? '#6d28d9' : 'var(--text)'}">${c.compte}</span>
          </td>
          <td style="padding:10px 16px;font-size:13px">${c.intitule || '—'}</td>
          <td style="padding:10px 16px;text-align:center">
            <span style="background:#f1f5f9;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">${c.classe ?? '—'}</span>
          </td>
          <td style="padding:10px 16px;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.3px">${c.nature || '—'}</td>
          <td style="padding:10px 16px;text-align:center">
            ${isCustom
              ? `<span style="background:#ede9fe;color:#6d28d9;padding:2px 9px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:.3px">✦ ADDITIF</span>`
              : `<span style="background:#f1f5f9;color:#94a3b8;padding:2px 9px;border-radius:10px;font-size:10px;font-weight:600">SYSCOHADA</span>`}
          </td>
          ${canEditRows ? `<td style="padding:8px 12px;text-align:center">
            ${isCustom ? `<button onclick="deleteCompteCustom('${c.compte.replace(/'/g,"\\'")}','${(c.intitule||'').replace(/'/g,"\\'")}')"
              title="Supprimer ce compte additif"
              style="background:none;border:1px solid #fca5a5;border-radius:6px;padding:4px 8px;cursor:pointer;color:#dc2626;font-size:12px;transition:all .12s"
              onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='none'">✕</button>` : ''}
          </td>` : ''}
        </tr>`;
      }).join('');

  const canEdit = ['directeur','super_admin','comptable_cabinet'].includes(state.user?.role);
  const customCount = all.filter(c => c.source === 'custom').length;

  container.innerHTML = `
    <div style="max-width:100%">
      <!-- En-tête + recherche -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px;flex-wrap:wrap">
        <div>
          <h3 style="font-size:18px;font-weight:700;margin:0 0 4px 0">Plan comptable SYSCOHADA révisé</h3>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:12px;color:var(--text-muted)">${stats?.total || all.length} comptes · Référentiel OHADA</span>
            ${customCount > 0 ? `<span style="font-size:11px;background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:10px;font-weight:600">${customCount} compte${customCount>1?'s':''} additif${customCount>1?'s':''}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="plan-search" type="search" placeholder="🔍 Rechercher compte ou intitulé…"
            value="${currentQuery || ''}"
            oninput="filterPlanByQuery(this.value)"
            style="padding:9px 12px;border:1.5px solid var(--border);border-radius:7px;font-size:13px;min-width:240px;transition:border-color .15s,box-shadow .15s"
            onfocus="this.style.borderColor='var(--accent)';this.style.boxShadow='0 0 0 3px rgba(59,130,246,.12)'"
            onblur="this.style.borderColor='var(--border)';this.style.boxShadow='none'"/>
          ${currentClasse !== null || currentQuery ? `
            <button onclick="resetPlanFilters()" class="btn-ghost" style="padding:9px 14px;font-size:12px">✕ Effacer</button>` : ''}
          ${canEdit ? `
            <button onclick="openModalAddCompte()" style="display:flex;align-items:center;gap:7px;padding:9px 18px;
              background:linear-gradient(135deg,#6d28d9,#4f46e5);color:white;border:none;border-radius:9px;
              cursor:pointer;font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(109,40,217,.25);
              transition:all .15s"
              onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 14px rgba(109,40,217,.35)'"
              onmouseout="this.style.transform='';this.style.boxShadow='0 2px 8px rgba(109,40,217,.25)'">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Compte additif
            </button>` : ''}
        </div>
      </div>

      <!-- Cartes par classe -->
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;overflow-x:auto;padding-bottom:4px">
        <button onclick="filterPlanByClasse(null)"
          style="background:${currentClasse === null ? 'var(--accent-purple,#7c3aed)' : 'white'};
                 color:${currentClasse === null ? 'white' : 'var(--text)'};
                 border:1.5px solid ${currentClasse === null ? 'var(--accent-purple,#7c3aed)' : 'var(--border)'};
                 padding:10px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;
                 display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:140px;text-align:left;transition:all .12s">
          <span>Toutes</span>
          <span style="font-size:10px;font-weight:500;opacity:.8">Classes 1 à 7</span>
          <span style="font-size:10px;font-weight:700;margin-top:2px">${stats?.total || all.length} comptes</span>
        </button>
        ${classCards}
      </div>

      <!-- Tableau -->
      <div style="background:white;border:1px solid var(--border);border-radius:12px;overflow:hidden">
        <div style="padding:12px 16px;background:#f8fafc;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted);display:flex;justify-content:space-between;align-items:center">
          <span>${filtered.length} compte(s)${currentClasse !== null ? ` · Classe ${currentClasse}` : ''}${currentQuery ? ` · « ${currentQuery} »` : ''}</span>
          ${truncated ? `<span style="color:#d97706;font-weight:600">⚠️ Affichage limité à ${MAX_DISPLAY} — affinez votre recherche</span>` : ''}
        </div>
        <div style="max-height:60vh;overflow-y:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead style="position:sticky;top:0;background:white;z-index:1">
              <tr style="border-bottom:1.5px solid var(--border)">
                <th style="text-align:left;padding:10px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-muted);width:130px">Compte</th>
                <th style="text-align:left;padding:10px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-muted)">Intitulé</th>
                <th style="text-align:center;padding:10px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-muted);width:80px">Classe</th>
                <th style="text-align:left;padding:10px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-muted);width:110px">Nature</th>
                <th style="text-align:center;padding:10px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-muted);width:110px">Source</th>
                ${canEdit ? `<th style="width:60px"></th>` : ''}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;

  // Re-focus sur le champ de recherche pour ne pas casser la frappe
  if(currentQuery){
    const inp = $('plan-search');
    if(inp){ inp.focus(); inp.setSelectionRange(currentQuery.length, currentQuery.length); }
  }
};

window.filterPlanByClasse = (classeId) => {
  _planState.currentClasse = classeId;
  renderTabPlan();
};

// Debounce léger sur la recherche pour ne pas re-render à chaque touche
let _planSearchTimer = null;
window.filterPlanByQuery = (q) => {
  _planState.currentQuery = q || '';
  clearTimeout(_planSearchTimer);
  _planSearchTimer = setTimeout(() => renderTabPlan(), 120);
};

window.resetPlanFilters = () => {
  _planState.currentClasse = null;
  _planState.currentQuery  = '';
  renderTabPlan();
};

// ── Plan comptable — Compte additif ───────────────────────────────────────
const PLAN_CLASSES_META = {
  1: { label: 'Ressources durables',        color: '#dbeafe', text: '#1d4ed8', icon: '🏦' },
  2: { label: 'Actif immobilisé',           color: '#dcfce7', text: '#15803d', icon: '🏗️' },
  3: { label: 'Stocks',                     color: '#fef9c3', text: '#a16207', icon: '📦' },
  4: { label: 'Tiers',                      color: '#fce7f3', text: '#be185d', icon: '🤝' },
  5: { label: 'Trésorerie',                color: '#f0fdf4', text: '#166534', icon: '💰' },
  6: { label: 'Charges',                    color: '#ffedd5', text: '#c2410c', icon: '📉' },
  7: { label: 'Produits',                   color: '#ede9fe', text: '#7c3aed', icon: '📈' },
  8: { label: 'Comptes spéciaux',           color: '#f1f5f9', text: '#475569', icon: '📋' },
  9: { label: 'Comptes analytiques',        color: '#fdf4ff', text: '#86198f', icon: '🔬' },
};

const PLAN_NATURES = [
  { val: '',                        label: '— Non défini —' },
  { val: 'actif',                   label: 'Actif' },
  { val: 'passif',                  label: 'Passif' },
  { val: 'charge',                  label: 'Charge' },
  { val: 'produit',                 label: 'Produit' },
  { val: 'tresorerie',             label: 'Trésorerie' },
  { val: 'hors_activites_ordinaires', label: 'Hors activités ordinaires (HAO)' },
];

window.openModalAddCompte = () => {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-add-compte" onclick="if(event.target===this)closeModalAddCompte()">
      <div class="modal-box" style="max-width:520px">
        <div class="modal-head" style="background:linear-gradient(135deg,#6d28d9,#4f46e5)">
          <h3 style="color:white">✦ Nouveau compte additif</h3>
          <button class="modal-close" onclick="closeModalAddCompte()" style="color:white;opacity:.8">✕</button>
        </div>
        <div class="modal-body">

          <!-- Bannière info -->
          <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:12px 14px;margin-bottom:20px;display:flex;gap:10px;align-items:flex-start">
            <span style="font-size:18px;flex-shrink:0">💡</span>
            <p style="font-size:12px;color:#5b21b6;margin:0;line-height:1.6">
              Un <strong>compte additif</strong> étend le référentiel SYSCOHADA avec vos comptes spécifiques.
              Il peut être supprimé à tout moment. Les comptes SYSCOHADA sont protégés.
            </p>
          </div>

          <!-- Numéro de compte -->
          <div class="form-section">
            <label>Numéro de compte <span class="req">*</span></label>
            <input type="text" id="ac-compte" placeholder="Ex: 6011, 411200, 5312…"
              maxlength="20" oninput="onCompteInput(this.value)"
              style="font-family:monospace;font-size:15px;font-weight:700;letter-spacing:1px"/>
            <span class="field-hint">La classe est automatiquement déduite du premier chiffre.</span>
          </div>

          <!-- Prévisualisation classe (affiché dynamiquement) -->
          <div id="ac-classe-preview" style="margin-bottom:16px;display:none">
            <div id="ac-classe-card" style="border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:10px">
              <span id="ac-classe-icon" style="font-size:20px"></span>
              <div>
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;opacity:.7" id="ac-classe-num"></div>
                <div style="font-size:13px;font-weight:700" id="ac-classe-label"></div>
              </div>
            </div>
          </div>

          <!-- Intitulé -->
          <div class="form-section">
            <label>Intitulé du compte <span class="req">*</span></label>
            <input type="text" id="ac-intitule" placeholder="Ex: Achats de carburant, Loyer bureau central…" maxlength="300"/>
          </div>

          <!-- Nature + Classe manuelle (repli si non déduit) -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="form-section">
              <label>Nature comptable</label>
              <select id="ac-nature">
                ${PLAN_NATURES.map(n => `<option value="${n.val}">${n.label}</option>`).join('')}
              </select>
            </div>
            <div class="form-section">
              <label>Classe (si non déduite)</label>
              <select id="ac-classe">
                <option value="">— Auto —</option>
                ${Object.entries(PLAN_CLASSES_META).map(([k,v])=>`<option value="${k}">${k} — ${v.label}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalAddCompte()">Annuler</button>
          <button id="ac-save-btn" onclick="saveNewCompte()"
            style="display:flex;align-items:center;gap:8px;padding:10px 22px;
              background:linear-gradient(135deg,#6d28d9,#4f46e5);color:white;border:none;
              border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;
              box-shadow:0 2px 8px rgba(109,40,217,.25)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Ajouter au plan
          </button>
        </div>
      </div>
    </div>`);
  setTimeout(() => document.getElementById('ac-compte')?.focus(), 80);
};

window.onCompteInput = (val) => {
  const num = val.trim();
  const firstDigit = num.match(/^(\d)/);
  const preview = document.getElementById('ac-classe-preview');
  const card    = document.getElementById('ac-classe-card');
  const icon    = document.getElementById('ac-classe-icon');
  const num_el  = document.getElementById('ac-classe-num');
  const lbl     = document.getElementById('ac-classe-label');
  const sel     = document.getElementById('ac-classe');

  if (firstDigit && PLAN_CLASSES_META[firstDigit[1]]) {
    const meta = PLAN_CLASSES_META[firstDigit[1]];
    if (card)  { card.style.background = meta.color; card.style.color = meta.text; }
    if (icon)    icon.textContent = meta.icon;
    if (num_el)  num_el.textContent = `Classe ${firstDigit[1]}`;
    if (lbl)     lbl.textContent = meta.label;
    if (preview) preview.style.display = 'block';
    if (sel)     sel.value = '';
  } else {
    if (preview) preview.style.display = 'none';
  }
};

window.closeModalAddCompte = () => document.getElementById('modal-add-compte')?.remove();

window.saveNewCompte = async () => {
  const compte   = document.getElementById('ac-compte')?.value.trim();
  const intitule = document.getElementById('ac-intitule')?.value.trim();
  const nature   = document.getElementById('ac-nature')?.value || '';
  const classeEl = document.getElementById('ac-classe')?.value;

  if (!compte)   { toast('Le numéro de compte est obligatoire.','error'); return; }
  if (!intitule) { toast("L'intitulé du compte est obligatoire.",'error'); return; }

  // Déduction de classe
  const firstDigit = compte.match(/^(\d)/);
  const classe = classeEl ? parseInt(classeEl) : (firstDigit ? parseInt(firstDigit[1]) : null);

  const btn = document.getElementById('ac-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Ajout en cours…'; }

  const res = await api.post('/plan-comptable', { compte, intitule, classe, nature });
  if (res.error) {
    toast(res.error, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Ajouter au plan`; }
    return;
  }

  toast(`Compte ${compte} — ${intitule} ajouté au plan.`, 'success');
  closeModalAddCompte();
  // Invalide le cache et recharge
  _planState.all = [];
  await loadTabPlan();
};

window.deleteCompteCustom = async (compte, intitule) => {
  if (!confirm(`Désactiver le compte additif "${compte} — ${intitule}" ?\n\nIl n'apparaîtra plus dans le plan comptable.`)) return;
  const res = await api.delete(`/plan-comptable/${encodeURIComponent(compte)}`);
  if (res.error) { toast(res.error, 'error'); return; }
  toast(`Compte ${compte} retiré du plan.`, 'success');
  _planState.all = [];
  await loadTabPlan();
};

// ── Tab Journaux ──────────────────────────────────────────────────────────
const loadTabJournaux = async () => {
  const container=$('tab-journaux'); if(!container)return;
  const data=await api.get('/journaux');
  if(data.error){container.innerHTML=`<div class="alert-err">${data.error}</div>`;return;}
  const journaux=data.journaux||[];
  const users=await api.get('/users');
  const usersOpts=(Array.isArray(users)?users:[]).map(u=>`<option value="${u.id}">${u.username} (${u.role})</option>`).join('');

  const canEdit=['directeur','super_admin'].includes(state.user?.role);
  const typeLabels={caisse:'Caisse',banque:'Banque',om:'Orange Money',momo:'MTN MOMO',carte_prepayee:'Carte Prépayée',autre:'Autre'};

  let html=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="font-size:15px;font-weight:700">Journaux (${journaux.length})</h3>
      ${canEdit?`<button class="btn-add" onclick="openModalJournal(null)">+ Nouveau journal</button>`:''}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Icône</th><th>Code</th><th>Nom</th><th>Type</th><th>Responsable saisie</th><th>Responsable arrêt</th><th>Statut</th>${canEdit?'<th>Actions</th>':''}</tr></thead>
      <tbody>
        ${journaux.map(j=>`<tr style="${!j.actif?'opacity:.5':''}">
          <td style="font-size:18px">${TYPES_ICONS[j.type]||'📒'}</td>
          <td><span class="badge-rubrique">${j.code}</span></td>
          <td><strong>${j.nom}</strong></td>
          <td>${typeLabels[j.type]||j.type}</td>
          <td style="font-size:12px;color:var(--text-muted)">${j.responsable_saisie_nom||'—'}</td>
          <td style="font-size:12px;color:var(--text-muted)">${j.responsable_arret_nom||'—'}</td>
          <td><span class="statut-badge ${j.actif?'statut-valide':'statut-rejete'}">${j.actif?'Actif':'Inactif'}</span></td>
          ${canEdit?`<td><div class="row-actions">
            <button class="btn-icon" onclick='openModalJournal(${JSON.stringify(j)},\`${usersOpts}\`)'>✏️</button>
            <button class="btn-icon danger" onclick="deleteJournal(${j.id})">✕</button>
          </div></td>`:''}
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  container.innerHTML=html;
};

window.openModalJournal=(journal,usersOpts)=>{
  if(!usersOpts){ api.get('/users').then(users=>{
    const opts=(Array.isArray(users)?users:[]).map(u=>`<option value="${u.id}">${u.username} (${u.role})</option>`).join('');
    _buildModalJournal(journal,opts);
  }); } else { _buildModalJournal(journal,usersOpts); }
};

const _buildModalJournal=(journal,usersOpts)=>{
  const isEdit=!!journal;
  // Premier type par défaut en création = 'caisse' (préfixe CS)
  const defaultType = journal?.type || 'caisse';
  const typeOpts=['caisse','banque','om','momo','carte_prepayee','autre'].map(t=>
    `<option value="${t}" ${defaultType===t?'selected':''}>${t}</option>`).join('');

  const html=`
    <div class="modal-overlay" id="modal-journal" onclick="if(event.target===this)closeMJ()">
      <div class="modal-box">
        <div class="modal-head"><h3>${isEdit?'Modifier le journal':'Nouveau journal'}</h3>
          <button class="modal-close" onclick="closeMJ()">✕</button></div>
        <div class="modal-body">
          <div class="fgrid2">
            <div><label>Code ${isEdit?'':'<span style="font-weight:400;color:var(--text-muted);text-transform:none;letter-spacing:0">(auto)</span>'} *</label>
              <input id="jl-code" type="text" value="${journal?.code||''}"
                placeholder="Auto : CS1, BQ1…"
                ${isEdit?'readonly style="background:#f8fafc"':'data-user-edited="false"'}/>
            </div>
            <div><label>Type *</label>
              <select id="jl-type" ${isEdit?'disabled style="background:#f8fafc"':''}>${typeOpts}</select>
            </div>
          </div>
          <label>Nom *</label>
          <input id="jl-nom" type="text" value="${journal?.nom||''}" placeholder="Ex: Caisse Secrétariat"/>

          <div class="fgrid2">
            <div>
              <label style="display:flex;align-items:center;justify-content:space-between">
                <span>Responsable saisie</span>
                <button type="button" onclick="openModalUserFromJournal('jl-saisie')"
                  title="Créer un nouvel utilisateur"
                  style="background:none;border:1.5px solid var(--border);border-radius:6px;
                  padding:1px 8px;font-size:12px;cursor:pointer;color:var(--accent-purple,#7c3aed);
                  font-weight:600;text-transform:none;letter-spacing:0">+ Créer</button>
              </label>
              <select id="jl-saisie"><option value="">— Aucun —</option>${usersOpts}</select>
            </div>
            <div>
              <label style="display:flex;align-items:center;justify-content:space-between">
                <span>Responsable arrêt</span>
                <button type="button" onclick="openModalUserFromJournal('jl-arret')"
                  title="Créer un nouvel utilisateur"
                  style="background:none;border:1.5px solid var(--border);border-radius:6px;
                  padding:1px 8px;font-size:12px;cursor:pointer;color:var(--accent-purple,#7c3aed);
                  font-weight:600;text-transform:none;letter-spacing:0">+ Créer</button>
              </label>
              <select id="jl-arret"><option value="">— Aucun —</option>${usersOpts}</select>
            </div>
          </div>

          <label>Ordre d'affichage</label>
          <input id="jl-ordre" type="number" value="${journal?.ordre||0}" min="0"/>
          ${isEdit?`<div style="margin-top:12px;display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="jl-actif" ${journal?.actif?'checked':''} style="width:auto"/>
            <label style="margin:0;text-transform:none;font-size:13px">Journal actif</label>
          </div>`:''}
          <div id="jl-err" class="alert-err" style="display:none;margin-top:10px"></div>
        </div>
        <div class="modal-foot">
          <button class="btn-ghost" onclick="closeMJ()">Annuler</button>
          <button class="btn-primary" style="width:auto;margin-top:0"
            onclick="saveJournal('${journal?.id||''}')">💾 Enregistrer</button>
        </div>
      </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);

  // Pré-sélectionner responsables
  if(journal?.responsable_saisie) $('jl-saisie').value=journal.responsable_saisie;
  if(journal?.responsable_arret)  $('jl-arret').value=journal.responsable_arret;

  // ── Auto-suggestion du code (création uniquement) ──────────────────────
  if(!isEdit){
    // Suggestion initiale sur le type par défaut
    suggestJournalCode(defaultType);

    // Marquer le code comme "édité manuellement" si l'utilisateur tape
    $('jl-code').addEventListener('input', () => {
      $('jl-code').dataset.userEdited = 'true';
    });

    // Re-suggérer le code à chaque changement de type (sauf si édité manuellement)
    $('jl-type').addEventListener('change', (e) => {
      if($('jl-code').dataset.userEdited !== 'true'){
        suggestJournalCode(e.target.value);
      }
    });
  }
};

// ── Récupère le prochain code disponible et le pose dans #jl-code ────────
window.suggestJournalCode = async (type) => {
  try{
    const res = await api.get(`/journaux/next-code?type=${encodeURIComponent(type)}`);
    if(res?.code && $('jl-code')){
      $('jl-code').value = res.code;
      // On garde data-user-edited="false" pour permettre une nouvelle suggestion
      // si l'utilisateur change encore le type sans toucher au code.
    }
  } catch(_){ /* en cas d'erreur réseau, l'utilisateur peut saisir manuellement */ }
};

// ── Ouvre la modal user depuis la modal journal (par-dessus) ─────────────
// targetSelectId = 'jl-saisie' ou 'jl-arret' : select à pré-sélectionner après création
window.openModalUserFromJournal = (targetSelectId) => {
  // Mémoriser le contexte pour saveUser
  window.__journalUserContext = { targetSelectId };
  openModalUser(null);

  // Forcer le rôle "caissier" par défaut (cas d'usage le plus fréquent)
  setTimeout(() => {
    const roleSel = $('usr-role');
    if(roleSel) roleSel.value = 'caissier';
  }, 0);
};

// ── Rafraîchit les <select> de responsables de la modal journal ──────────
const refreshJournalUserSelects = async (newUserId, targetSelectId) => {
  const users = await api.get('/users');
  if(!Array.isArray(users)) return;
  const opts = users.map(u =>
    `<option value="${u.id}">${u.username} (${u.role})</option>`
  ).join('');
  const saisieSel = $('jl-saisie');
  const arretSel  = $('jl-arret');
  if(!saisieSel || !arretSel) return;
  // Conserver les valeurs déjà sélectionnées
  const savedSaisie = saisieSel.value;
  const savedArret  = arretSel.value;
  saisieSel.innerHTML = `<option value="">— Aucun —</option>${opts}`;
  arretSel.innerHTML  = `<option value="">— Aucun —</option>${opts}`;
  saisieSel.value = savedSaisie;
  arretSel.value  = savedArret;
  // Pré-sélectionner le nouvel utilisateur sur le select cible
  if(newUserId && targetSelectId){
    const target = $(targetSelectId);
    if(target) target.value = newUserId;
  }
};

window.closeMJ=()=>{const m=$('modal-journal');if(m)m.remove();};
window.saveJournal=async(id)=>{
  const errEl=$('jl-err');
  const body={
    code:$('jl-code').value.trim().toUpperCase(),
    nom:$('jl-nom').value.trim(),
    type:$('jl-type').value,
    ordre:parseInt($('jl-ordre').value)||0,
    responsable_saisie:$('jl-saisie').value||null,
    responsable_arret:$('jl-arret').value||null,
    ...( id?{actif:$('jl-actif')?.checked!==false}:{} ),
  };
  // En création, le code peut être vide → le backend le générera
  if(!body.nom||!body.type){errEl.textContent='Nom et type obligatoires.';errEl.style.display='block';return;}
  const res=id?await api.put(`/journaux/${id}`,body):await api.post('/journaux',body);
  if(res.error){errEl.textContent=res.error;errEl.style.display='block';return;}
  closeMJ(); toast(id?'Journal modifié ✓':`Journal créé ✓ (${res.code})`,'success');
  await loadJournaux(); await loadTabJournaux();
};
window.deleteJournal=async(id)=>{
  if(!confirm('Supprimer ce journal ? (Impossible s\'il contient des mouvements)'))return;
  const res=await api.delete(`/journaux/${id}`);
  if(res.error){toast(res.error,'error');return;}
  toast('Journal supprimé.','success'); await loadJournaux(); await loadTabJournaux();
};

// ── Tab Rubriques ─────────────────────────────────────────────────────────
const loadTabRubriques = async () => {
  const container=$('tab-rubriques'); if(!container)return;
  await loadRubriques();
  const canEdit=['directeur','super_admin','comptable_cabinet'].includes(state.user?.role);

  // Badge virement : vert si non, rouge si oui
  const virementBadge = (val) => val
    ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;
        font-size:11px;font-weight:700;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5">
        ✓ Oui</span>`
    : `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;
        font-size:11px;font-weight:700;background:#dcfce7;color:#166534;border:1px solid #86efac">
        ✗ Non</span>`;

  const renderSection=(titre,liste,type)=>`
    <div style="margin-bottom:24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h4 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
          color:var(--text-muted)">${titre} (${liste.length})</h4>
        ${canEdit?`<button class="btn-add" style="font-size:12px;padding:6px 12px"
          onclick="openModalRubrique(null,'${type}')">+ Ajouter</button>`:''}
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Code</th>
          <th>Intitulé</th>
          <th>Code comptable</th>
          <th style="text-align:center">Virement interne</th>
          ${canEdit?'<th>Actions</th>':''}
        </tr></thead>
        <tbody>${liste.map(r=>`<tr>
          <td><span class="badge-rubrique">${r.code}</span></td>
          <td style="font-weight:500">${r.intitule}</td>
          <td style="font-size:12px;color:var(--text-muted);font-family:monospace">
            ${r.code_comptable||'<span style="color:var(--text-light)">—</span>'}
          </td>
          <td style="text-align:center">${virementBadge(r.est_virement_interne)}</td>
          ${canEdit?`<td><div class="row-actions">
            <button class="btn-icon" onclick='openModalRubrique(${JSON.stringify(r)})'>✏️</button>
            <button class="btn-icon danger" onclick="deleteRubrique(${r.id})">✕</button>
          </div></td>`:''}
        </tr>`).join('')}
        ${liste.length===0?`<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted)">
          Aucune rubrique.</td></tr>`:''}
        </tbody>
      </table></div>
    </div>`;

  container.innerHTML=`
    <h3 style="font-size:15px;font-weight:700;margin-bottom:4px">Rubriques</h3>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:18px">
      Le code comptable est facultatif — il sera utilisé pour les exports SAGE i7.
    </p>
    ${renderSection('Entrées',state.rubriques.entrees||[],'entree')}
    ${renderSection('Dépenses',state.rubriques.depenses||[],'depense')}`;
};

window.openModalRubrique=(rubrique,defaultType)=>{
  const isEdit=!!rubrique;
  const html=`
    <div class="modal-overlay" id="modal-rubrique" onclick="if(event.target===this)closeModalRub()">
      <div class="modal-box">
        <div class="modal-head">
          <h3>${isEdit?'Modifier la rubrique':'Nouvelle rubrique'}</h3>
          <button class="modal-close" onclick="closeModalRub()">✕</button>
        </div>
        <div class="modal-body">

          <div class="fgrid2">
            <div>
              <label>Code *</label>
              <input id="rub-code" type="text" value="${rubrique?.code||''}"
                placeholder="Ex: 14, ABQ, SCOM"
                ${isEdit?'readonly style="background:#f8fafc;font-family:monospace"':''}/>
            </div>
            <div>
              <label>Type *</label>
              <select id="rub-type">
                <option value="entree"  ${(rubrique?.type||defaultType)==='entree' ?'selected':''}>Entrée</option>
                <option value="depense" ${(rubrique?.type||defaultType)==='depense'?'selected':''}>Dépense</option>
              </select>
            </div>
          </div>

          <label>Intitulé *</label>
          <input id="rub-intitule" type="text" value="${rubrique?.intitule||''}"
            placeholder="Ex: FRAIS DE TRANSPORT DIVERS"/>

          <label>Code comptable
            <span style="font-size:11px;font-weight:400;color:var(--text-muted);margin-left:4px">
              (optionnel — SYSCOHADA / SAGE i7)
            </span>
          </label>
          <div style="position:relative">
            <input id="rub-code-comptable" type="text"
              value="${rubrique?.code_comptable||''}"
              placeholder="Ex: 6251, transport, salaire…"
              style="font-family:monospace;width:100%"
              autocomplete="off"
              oninput="searchPlanComptable(this.value)"/>
            <div id="plan-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;
              background:white;border:1.5px solid var(--accent);border-top:none;
              border-radius:0 0 8px 8px;box-shadow:0 8px 24px rgba(0,0,0,.12);
              z-index:200;max-height:220px;overflow-y:auto"></div>
          </div>

          <label style="margin-top:14px;display:block">Virement interne</label>
          <div style="display:flex;align-items:center;gap:12px;margin-top:6px">
            <label class="toggle-switch">
              <input type="checkbox" id="rub-virement"
                ${rubrique?.est_virement_interne?'checked':''}/>
              <span class="toggle-slider"></span>
            </label>
            <span id="rub-virement-label" style="font-size:13px;color:var(--text-muted)">
              ${rubrique?.est_virement_interne
                ?'<span style="color:#991b1b;font-weight:600">Oui — exclure du budget</span>'
                :'<span style="color:#166534;font-weight:600">Non — inclure dans le budget</span>'}
            </span>
          </div>

          <div id="rub-err" class="alert-err" style="display:none;margin-top:12px"></div>
        </div>
        <div class="modal-foot">
          <button class="btn-ghost" onclick="closeModalRub()">Annuler</button>
          <button class="btn-primary" style="width:auto;margin-top:0"
            onclick="saveRubrique('${rubrique?.id||''}')">💾 Enregistrer</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend',html);

  // Mise à jour live du label virement
  const chk=$('rub-virement'), lbl=$('rub-virement-label');
  if(chk&&lbl){
    chk.addEventListener('change',()=>{
      lbl.innerHTML=chk.checked
        ?'<span style="color:#991b1b;font-weight:600">Oui — exclure du budget</span>'
        :'<span style="color:#166534;font-weight:600">Non — inclure dans le budget</span>';
    });
  }
};

// ── Autocomplétion Plan Comptable SYSCOHADA ───────────────────────────────
let _planTimer = null;
window.searchPlanComptable = (val) => {
  const dropdown = $('plan-dropdown');
  if (!dropdown) return;
  clearTimeout(_planTimer);
  if (!val || val.trim().length < 2) { dropdown.style.display='none'; return; }
  _planTimer = setTimeout(async () => {
    const results = await api.get(`/plan-comptable/search?q=${encodeURIComponent(val.trim())}`);
    if (!Array.isArray(results) || results.length === 0) {
      dropdown.style.display = 'none'; return;
    }
    const natureColors = {
      charge:'#fee2e2', produit:'#dcfce7', actif:'#dbeafe',
      passif:'#fef3c7', tresorerie:'#ede9fe', capitaux:'#f0fdf4',
    };
    dropdown.innerHTML = results.map(r => `
      <div onclick="selectCompte('${r.compte}','${r.intitule.replace(/'/g,"\'")}')"
        style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;
          display:flex;align-items:center;gap:10px;font-size:13px"
        onmouseover="this.style.background='#eff6ff'"
        onmouseout="this.style.background='white'">
        <span style="font-family:monospace;font-weight:700;font-size:12px;
          padding:2px 7px;border-radius:5px;background:${natureColors[r.nature]||'#f1f5f9'};
          color:#1e293b;flex-shrink:0">${r.compte}</span>
        <span style="flex:1;color:var(--text)">${r.intitule}</span>
        <span style="font-size:10px;color:var(--text-muted);flex-shrink:0">Cl.${r.classe}</span>
      </div>`).join('');
    dropdown.style.display = 'block';
  }, 280);
};

window.selectCompte = (compte, intitule) => {
  const inp = $('rub-code-comptable');
  const drp = $('plan-dropdown');
  if (inp) inp.value = compte;
  if (drp) drp.style.display = 'none';
  // Afficher l'intitulé en hint
  const hint = document.getElementById('plan-hint');
  if (hint) { hint.textContent = intitule; hint.style.display='block'; }
};

// Fermer dropdown si clic ailleurs
document.addEventListener('click', (e) => {
  const drp = $('plan-dropdown');
  if (drp && !drp.contains(e.target) && e.target.id !== 'rub-code-comptable') {
    drp.style.display = 'none';
  }
});

window.closeModalRub=()=>{const m=$('modal-rubrique');if(m)m.remove();};

window.saveRubrique=async(id)=>{
  const errEl=$('rub-err');
  const code          = $('rub-code').value.trim().toUpperCase();
  const intitule      = $('rub-intitule').value.trim().toUpperCase();
  const type          = $('rub-type').value;
  const codeComptable = $('rub-code-comptable').value.trim() || null;
  const estVirement   = $('rub-virement').checked;

  if(!intitule){ errEl.textContent='Intitulé obligatoire.'; errEl.style.display='block'; return; }
  if(!id && !code){ errEl.textContent='Code obligatoire.'; errEl.style.display='block'; return; }

  const body = id
    ? { intitule, code_comptable: codeComptable, est_virement_interne: estVirement,
        ordre: parseInt($('rub-ordre')?.value)||0, actif: true }
    : { code, intitule, type, code_comptable: codeComptable,
        est_virement_interne: estVirement, ordre: 0 };

  const res = id
    ? await api.put(`/rubriques/${id}`, body)
    : await api.post('/rubriques', body);

  if(res.error){ errEl.textContent=res.error; errEl.style.display='block'; return; }
  closeModalRub();
  toast(id?'Rubrique modifiée ✓':'Rubrique créée ✓','success');
  await loadRubriques(); await loadTabRubriques();
};

window.deleteRubrique=async(id)=>{
  if(!confirm('Désactiver cette rubrique ?'))return;
  await api.delete(`/rubriques/${id}`);
  toast('Rubrique désactivée.','success'); await loadRubriques(); await loadTabRubriques();
};

// ── Tab Users ─────────────────────────────────────────────────────────────
const ROLES_LABELS={directeur:'👔 Directeur',caissier:'🧾 Caissier(ère)',auditeur:'🔍 Auditeur',comptable_cabinet:'📊 Comptable Cabinet',super_admin:'⚙️ Super Admin'};
const ROLES_COLORS={directeur:'#dbeafe',caissier:'#fce7f3',auditeur:'#fef3c7',comptable_cabinet:'#dcfce7',super_admin:'#ede9fe'};

const loadTabUsers = async () => {
  const container=$('tab-users'); if(!container)return;
  const users=await api.get('/users');
  if(users.error){container.innerHTML=`<div class="alert-err">${users.error}</div>`;return;}
  const canEdit=['directeur','super_admin'].includes(state.user?.role);
  const isSuperAdmin = state.user?.role === 'super_admin';

  container.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="font-size:15px;font-weight:700">Utilisateurs (${users.length})</h3>
      ${canEdit?`<button class="btn-add" onclick="openModalUser(null)">+ Nouvel utilisateur</button>`:''}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Utilisateur</th><th>Accès système</th><th>Profil métier</th><th>Email</th><th>Dernière connexion</th><th>Statut</th>${canEdit?'<th>Actions</th>':''}</tr></thead>
      <tbody>
        ${users.map(u=>{
          const isMe=u.id===state.user?.id;
          const bg=ROLES_COLORS[u.role]||'#f1f5f9';
          const conn=u.derniere_connexion?new Date(u.derniere_connexion).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Jamais';
          const roleCol = u.custom_role_couleur || '#6366f1';
          return `<tr style="${!u.actif?'opacity:.5':''}">
            <td><div style="display:flex;align-items:center;gap:8px">
              <div style="width:32px;height:32px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${u.username.substring(0,2).toUpperCase()}</div>
              <span style="font-weight:600;font-size:13px">${u.username}${isMe?'<span style="font-size:10px;color:var(--accent);margin-left:4px">(vous)</span>':''}</span>
            </div></td>
            <td><span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;background:${bg};color:#1e293b">${ROLES_LABELS[u.role]||u.role}</span></td>
            <td>${u.custom_role_nom
              ? `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${roleCol}18;color:${roleCol};border:1px solid ${roleCol}40">
                  <span style="width:6px;height:6px;border-radius:50%;background:${roleCol};display:inline-block"></span>
                  ${u.custom_role_nom}
                 </span>`
              : '<span style="font-size:12px;color:var(--text-muted)">—</span>'
            }</td>
            <td style="font-size:12px;color:var(--text-muted)">${u.email||'—'}</td>
            <td style="font-size:12px;color:var(--text-muted)">${conn}</td>
            <td><span class="statut-badge ${u.actif?'statut-valide':'statut-rejete'}">${u.actif?'✓ Actif':'✗ Inactif'}</span></td>
            ${canEdit?`<td><div class="row-actions">
              <button class="btn-icon" onclick='openModalUser(${JSON.stringify(u)})'>✏️</button>
              <button class="btn-icon" onclick="openModalResetPwd('${u.id}','${u.username}')">🔑</button>
              ${isSuperAdmin?`<button class="btn-icon" title="Permissions" onclick="openModalUserPerms('${u.id}','${u.username.replace(/'/g,"\\'")}')">🔐</button>`:''}
              <button class="btn-icon ${u.actif?'danger':''}" onclick="toggleUser('${u.id}')" ${isMe?'disabled':''}>${u.actif?'⏸':'▶️'}</button>
              ${!isMe?`<button class="btn-icon danger" onclick="deleteUser('${u.id}','${u.username}')">✕</button>`:''}
            </div></td>`:''}
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
};

// ── TAB PIÈCES JUSTIFICATIVES ─────────────────────────────────────────────
const loadTabPieces = async () => {
  const container=$('tab-pieces'); if(!container)return;
  const [types, rubriques_data] = await Promise.all([
    api.get('/pieces/types'),
    api.get('/rubriques'),
  ]);
  if(types.error){container.innerHTML=`<div class="alert-err">${types.error}</div>`;return;}

  const canEdit=['directeur','super_admin','comptable_cabinet'].includes(state.user?.role);
  const allRubriques=[...(rubriques_data.entrees||[]),...(rubriques_data.depenses||[])];

  // Grouper par rubrique
  const grouped={};
  (types||[]).forEach(t=>{
    if(!grouped[t.rubrique_code]) grouped[t.rubrique_code]=[];
    grouped[t.rubrique_code].push(t);
  });

  const rubriqueOpts=allRubriques.map(r=>
    `<option value="${r.code}">[${r.code}] ${r.intitule}</option>`).join('');

  let html=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div>
        <h3 style="font-size:15px;font-weight:700">Pièces justificatives par rubrique</h3>
        <p style="font-size:12px;color:var(--text-muted);margin-top:2px">
          Définissez les justificatifs attendus pour chaque type de dépense.
          Ils apparaîtront en annotation dans le formulaire de saisie.
        </p>
      </div>
      ${canEdit?`<button class="btn-add" onclick="openModalPieceType(null)">+ Ajouter</button>`:''}
    </div>`;

  if(Object.keys(grouped).length===0){
    html+=`<div style="text-align:center;padding:40px;background:white;border:1px solid var(--border);
      border-radius:12px;color:var(--text-muted)">
      <div style="font-size:36px;margin-bottom:10px">📎</div>
      <p>Aucune pièce justificative configurée.</p>
      <p style="font-size:12px;margin-top:4px">Commencez par ajouter les justificatifs attendus par rubrique.</p>
    </div>`;
  } else {
    // Afficher par rubrique
    Object.entries(grouped).forEach(([code,items])=>{
      const rub=allRubriques.find(r=>r.code===code);
      html+=`
        <div style="background:white;border:1px solid var(--border);border-radius:10px;
          margin-bottom:12px;overflow:hidden;">
          <div style="padding:10px 16px;background:#f8fafc;border-bottom:1px solid var(--border);
            display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="badge-rubrique">${code}</span>
              <span style="font-size:13px;font-weight:600">${rub?.intitule||code}</span>
            </div>
            ${canEdit?`<button class="btn-icon" style="font-size:12px"
              onclick="openModalPieceType({rubrique_code:'${code}',id:null})">+ Ajouter</button>`:''}
          </div>
          <div style="padding:10px 16px">
            ${items.map(item=>`
              <div style="display:flex;align-items:center;gap:10px;padding:7px 0;
                border-bottom:1px solid #f8fafc">
                <span style="font-size:16px">${item.obligatoire?'🔴':'🟡'}</span>
                <div style="flex:1">
                  <span style="font-size:13px;font-weight:500">${item.intitule_piece}</span>
                  ${item.description?`<span style="font-size:11px;color:var(--text-muted);margin-left:6px">— ${item.description}</span>`:''}
                </div>
                <span style="font-size:10px;padding:2px 7px;border-radius:10px;font-weight:600;
                  background:${item.obligatoire?'#fee2e2':'#fef3c7'};
                  color:${item.obligatoire?'#991b1b':'#92400e'}">
                  ${item.obligatoire?'Obligatoire':'Recommandée'}
                </span>
                ${canEdit?`<div class="row-actions">
                  <button class="btn-icon" onclick='openModalPieceType(${JSON.stringify(item)})'>✏️</button>
                  <button class="btn-icon danger" onclick="deletePieceType(${item.id})">✕</button>
                </div>`:''}
              </div>`).join('')}
          </div>
        </div>`;
    });
  }
  container.innerHTML=html;
};

window.openModalPieceType=async(item)=>{
  const isEdit=!!(item&&item.id);
  // Charger les rubriques dynamiquement (évite les problèmes d'échappement)
  const allRub=[...(state.rubriques.entrees||[]),...(state.rubriques.depenses||[])];
  const rubriqueOpts=allRub.map(r=>`<option value="${r.code}">[${r.code}] ${r.intitule}</option>`).join('');
  const html=`
    <div class="modal-overlay" id="modal-piece-type" onclick="if(event.target===this)closeMPT()">
      <div class="modal-box" style="max-width:480px">
        <div class="modal-head">
          <h3>${isEdit?'Modifier':'Nouvelle pièce justificative'}</h3>
          <button class="modal-close" onclick="closeMPT()">✕</button>
        </div>
        <div class="modal-body">
          <label>Rubrique *</label>
          <select id="pt-rubrique">
            <option value="">— Choisir —</option>${rubriqueOpts}
          </select>
          <label>Intitulé de la pièce *</label>
          <input id="pt-intitule" type="text" value="${item?.intitule_piece||''}"
            placeholder="Ex: Bon de commande, Facture fournisseur…"/>
          <label>Description / Précision</label>
          <input id="pt-description" type="text" value="${item?.description||''}"
            placeholder="Ex: Signé par le directeur et tamponné"/>
          <div style="margin-top:14px;display:flex;align-items:center;gap:12px">
            <label class="toggle-switch">
              <input type="checkbox" id="pt-obligatoire" ${item?.obligatoire?'checked':''}/>
              <span class="toggle-slider"></span>
            </label>
            <span style="font-size:13px;font-weight:500">Pièce obligatoire</span>
          </div>
          <div id="pt-err" class="alert-err" style="display:none;margin-top:10px"></div>
        </div>
        <div class="modal-foot">
          <button class="btn-ghost" onclick="closeMPT()">Annuler</button>
          <button class="btn-primary" style="width:auto;margin-top:0"
            onclick="savePieceType('${item?.id||''}')">💾 Enregistrer</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  if(item?.rubrique_code) $('pt-rubrique').value=item.rubrique_code;
};
window.closeMPT=()=>{const m=$('modal-piece-type');if(m)m.remove();};
window.savePieceType=async(id)=>{
  const errEl=$('pt-err');
  const rubrique=$('pt-rubrique').value;
  const intitule=$('pt-intitule').value.trim();
  if(!rubrique||!intitule){errEl.textContent='Rubrique et intitulé obligatoires.';errEl.style.display='block';return;}
  const body={rubrique_code:rubrique,intitule_piece:intitule,
    description:$('pt-description').value.trim(),
    obligatoire:$('pt-obligatoire').checked};
  const res=id?await api.put(`/pieces/types/${id}`,body):await api.post('/pieces/types',body);
  if(res.error){errEl.textContent=res.error;errEl.style.display='block';return;}
  closeMPT(); toast(id?'Pièce modifiée ✓':'Pièce ajoutée ✓','success');
  await loadTabPieces();
};
window.deletePieceType=async(id)=>{
  if(!confirm('Supprimer ce type de pièce ?'))return;
  await api.delete(`/pieces/types/${id}`);
  toast('Type supprimé.','success'); await loadTabPieces();
};

window.openModalUser = async (user) => {
  const isEdit = !!user;
  // Insérer un modal squelette immédiatement
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-user" onclick="if(event.target===this)closeModalUser()">
      <div class="modal-box" style="max-width:560px">
        <div class="modal-head" style="background:linear-gradient(135deg,#1e40af,#3b82f6);border-radius:14px 14px 0 0">
          <h3 style="color:white;margin:0;font-size:16px">${isEdit ? '✏️ Modifier l\'utilisateur' : '👤 Nouvel utilisateur'}</h3>
          <button class="modal-close" onclick="closeModalUser()" style="color:white;opacity:.8">✕</button>
        </div>
        <div class="modal-body" id="usr-modal-body">
          <div class="loading-msg">Chargement…</div>
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalUser()">Annuler</button>
          <button id="usr-save-btn" onclick="saveUser('${user?.id||''}')"
            style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;border:none;border-radius:10px;padding:9px 22px;font-size:13px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:7px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            ${isEdit ? 'Enregistrer' : 'Créer l\'utilisateur'}
          </button>
        </div>
      </div>
    </div>`);

  // Charger les rôles disponibles
  const roles = await api.get('/roles');
  const rolesOk = Array.isArray(roles) ? roles : [];

  const rolesOpts = ['directeur','caissier','auditeur','comptable_cabinet'].map(r =>
    `<option value="${r}" ${user?.role===r?'selected':''}>${ROLES_LABELS[r]}</option>`).join('');

  const rolesGrid = rolesOk.length === 0
    ? `<p style="font-size:12px;color:var(--text-muted);margin:4px 0">Aucun profil métier défini. Créez-en dans Configuration → Rôles.</p>`
    : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:8px">
        <label style="cursor:pointer">
          <input type="radio" name="usr-custom-role" value="" ${!user?.custom_role_id?'checked':''} style="display:none"/>
          <div class="custom-role-card" data-selected="${!user?.custom_role_id?'1':'0'}"
            style="border:2px solid ${!user?.custom_role_id?'#94a3b8':'var(--border)'};border-radius:10px;padding:10px 12px;text-align:center;transition:all .15s;background:${!user?.custom_role_id?'#f8fafc':'white'}"
            onclick="selectCustomRole(this,'')">
            <div style="font-size:20px;margin-bottom:4px">🚫</div>
            <div style="font-size:11px;font-weight:700;color:var(--text-muted)">Aucun profil</div>
          </div>
        </label>
        ${rolesOk.map(r => {
          const selected = user?.custom_role_id === r.id;
          const col = r.couleur || '#6366f1';
          return `<label style="cursor:pointer">
            <input type="radio" name="usr-custom-role" value="${r.id}" ${selected?'checked':''} style="display:none"/>
            <div class="custom-role-card" data-selected="${selected?'1':'0'}"
              style="border:2px solid ${selected?col:'var(--border)'};border-radius:10px;padding:10px 12px;text-align:center;transition:all .15s;background:${selected?col+'15':'white'}"
              onclick="selectCustomRole(this,'${r.id}','${col}')">
              <div style="width:32px;height:32px;border-radius:8px;background:${col}22;margin:0 auto 6px;display:flex;align-items:center;justify-content:center">
                <span style="font-size:16px">🎭</span>
              </div>
              <div style="font-size:12px;font-weight:700;color:${selected?col:'var(--text)'};line-height:1.3">${r.nom}</div>
              ${r.description?`<div style="font-size:10px;color:var(--text-muted);margin-top:2px;line-height:1.3">${r.description}</div>`:''}
              <div style="margin-top:4px;font-size:10px;font-weight:600;color:${col};background:${col}18;border-radius:10px;padding:1px 6px;display:inline-block">
                ${r.nb_permissions||0} perm.
              </div>
            </div>
          </label>`;
        }).join('')}
      </div>`;

  const body = document.getElementById('usr-modal-body');
  if (!body) return;
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      <div class="form-section" style="margin:0">
        <label>Identifiant <span class="req">*</span></label>
        <input id="usr-username" type="text" value="${user?.username||''}" placeholder="Ex: marie_caisse"/>
      </div>
      <div class="form-section" style="margin:0">
        <label>Email</label>
        <input id="usr-email" type="email" value="${user?.email||''}" placeholder="email@exemple.com"/>
      </div>
    </div>

    <div class="form-section">
      <label>Accès système <span class="req">*</span></label>
      <span class="field-hint" style="margin-bottom:6px;display:block">Détermine ce que l'utilisateur peut administrer</span>
      <select id="usr-role" style="background:#f8fafc">${rolesOpts}</select>
    </div>

    <div class="form-section">
      <label style="display:flex;align-items:center;gap:8px">
        Profil métier
        <span style="font-size:10px;background:#f0fdf4;color:#16a34a;padding:1px 7px;border-radius:10px;font-weight:600">Optionnel</span>
      </label>
      <span class="field-hint" style="margin-bottom:8px;display:block">Groupe de permissions associé à ce poste</span>
      ${rolesGrid}
    </div>

    ${!isEdit ? `
    <div style="border-top:1px solid var(--border);margin-top:4px;padding-top:16px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="form-section" style="margin:0">
          <label>Mot de passe <span class="req">*</span></label>
          <input id="usr-pwd" type="password" placeholder="Minimum 6 caractères"/>
        </div>
        <div class="form-section" style="margin:0">
          <label>Confirmer <span class="req">*</span></label>
          <input id="usr-pwd2" type="password" placeholder="Répéter le mot de passe"/>
        </div>
      </div>
    </div>` : ''}

    <div id="usr-err" class="alert-err" style="display:none;margin-top:10px"></div>`;

  setTimeout(() => document.getElementById('usr-username')?.focus(), 80);
};

window.selectCustomRole = (card, roleId, couleur) => {
  // Décocher visuellement toutes les cards
  document.querySelectorAll('.custom-role-card').forEach(c => {
    c.style.borderColor = 'var(--border)';
    c.style.background = 'white';
    const lbl = c.querySelector('div:nth-child(2)');
    if(lbl) lbl.style.color = 'var(--text)';
  });
  // Cocher la sélectionnée
  const col = couleur || '#94a3b8';
  card.style.borderColor = col;
  card.style.background = col + '15';
  const lbl = card.querySelector('div:nth-child(2)');
  if(lbl) lbl.style.color = col;
  // Cocher le radio
  const radio = card.closest('label')?.querySelector('input[type=radio]');
  if(radio) radio.checked = true;
};
window.closeModalUser=()=>{const m=$('modal-user');if(m)m.remove();};
window.saveUser=async(id)=>{
  const errEl=$('usr-err');
  if(!errEl) return;
  const username=$('usr-username')?.value.trim();
  const email=$('usr-email')?.value.trim();
  const role=$('usr-role')?.value;
  const customRoleRaw = document.querySelector('input[name="usr-custom-role"]:checked')?.value;
  const custom_role_id = customRoleRaw ? parseInt(customRoleRaw) : null;
  if(!username||!role){errEl.textContent="Identifiant et rôle obligatoires.";errEl.style.display='block';return;}
  const btn = document.getElementById('usr-save-btn');
  if(btn){btn.disabled=true;btn.style.opacity='.6';}
  let res;
  if(id){ res=await api.put(`/users/${id}`,{username,email,role,custom_role_id}); }
  else{
    const pwd=$('usr-pwd')?.value,pwd2=$('usr-pwd2')?.value;
    if(!pwd||pwd.length<6){errEl.textContent='Minimum 6 caractères.';errEl.style.display='block';if(btn){btn.disabled=false;btn.style.opacity='1';}return;}
    if(pwd!==pwd2){errEl.textContent='Les mots de passe ne correspondent pas.';errEl.style.display='block';if(btn){btn.disabled=false;btn.style.opacity='1';}return;}
    res=await api.post('/users',{username,email,role,password:pwd,custom_role_id});
  }
  if(res.error){errEl.textContent=res.error;errEl.style.display='block';if(btn){btn.disabled=false;btn.style.opacity='1';}return;}
  closeModalUser(); toast(id?'Utilisateur modifié ✓':'Utilisateur créé ✓','success');

  // ── Si on vient de la modal journal : rafraîchir les selects et préselectionner ──
  if(window.__journalUserContext){
    const { targetSelectId } = window.__journalUserContext;
    window.__journalUserContext = null;
    await refreshJournalUserSelects(res.id, targetSelectId);
    return;
  }

  await loadTabUsers();
};
window.openModalResetPwd=(id,username)=>{
  const html=`<div class="modal-overlay" id="modal-resetpwd" onclick="if(event.target===this)closeModalResetPwd()">
    <div class="modal-box" style="max-width:420px">
      <div class="modal-head"><h3>🔑 Réinitialiser — ${username}</h3>
        <button class="modal-close" onclick="closeModalResetPwd()">✕</button></div>
      <div class="modal-body">
        <label>Nouveau mot de passe *</label><input id="rpwd-new" type="password" placeholder="Minimum 6 caractères"/>
        <label>Confirmer *</label><input id="rpwd-confirm" type="password"/>
        <div id="rpwd-err" class="alert-err" style="display:none;margin-top:10px"></div>
      </div>
      <div class="modal-foot">
        <button class="btn-ghost" onclick="closeModalResetPwd()">Annuler</button>
        <button class="btn-primary" style="width:auto;margin-top:0" onclick="doResetPwd('${id}')">🔑 Réinitialiser</button>
      </div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
};
window.closeModalResetPwd=()=>{const m=$('modal-resetpwd');if(m)m.remove();};
window.doResetPwd=async(id)=>{
  const pwd=$('rpwd-new').value,pwd2=$('rpwd-confirm').value,errEl=$('rpwd-err');
  if(!pwd||pwd.length<6){errEl.textContent='Minimum 6 caractères.';errEl.style.display='block';return;}
  if(pwd!==pwd2){errEl.textContent='Mots de passe différents.';errEl.style.display='block';return;}
  const res=await api.post(`/users/${id}/password`,{password:pwd});
  if(res.error){errEl.textContent=res.error;errEl.style.display='block';return;}
  closeModalResetPwd(); toast('Mot de passe réinitialisé ✓','success');
};
window.toggleUser=async(id)=>{
  const res=await api.patch(`/users/${id}/actif`,{});
  if(res.error){toast(res.error,'error');return;}
  toast(res.message,'success'); await loadTabUsers();
};
window.deleteUser=async(id,username)=>{
  if(!confirm(`Supprimer définitivement "${username}" ?`))return;
  const res=await api.delete(`/users/${id}`);
  if(res.error){toast(res.error,'error');return;}
  toast('Utilisateur supprimé.','success'); await loadTabUsers();
};

// ── Tab Entité ────────────────────────────────────────────────────────────
const loadTabEntite = async () => {
  const container = $('tab-entite'); if (!container) return;
  // Chargement parallèle : config + référentiel formes juridiques
  const [data, ref] = await Promise.all([
    api.get('/config'),
    api.get('/config/referentiel').catch(() => ({ formes_juridiques: [] })),
  ]);
  if (data.error) { container.innerHTML = `<div class="alert-err">${data.error}</div>`; return; }

  const canEdit = ['directeur','super_admin'].includes(state.user?.role);
  const ro      = canEdit ? '' : `readonly style="background:#f8fafc;cursor:not-allowed"`;
  const roSel   = canEdit ? '' : `disabled style="background:#f8fafc;cursor:not-allowed"`;

  // Style helpers (évite la répétition)
  const labelStyle = `style="display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:var(--text-muted);margin-bottom:5px"`;
  const inputStyle = `style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:7px;font-size:13px"`;
  const blockStyle = `style="margin-bottom:12px"`;

  // Construire les options du <select> Forme juridique
  const optsFJ = (ref.formes_juridiques || []).map(f =>
    `<option value="${f.code}" ${data.forme_juridique === f.code ? 'selected' : ''}>${f.label}</option>`
  ).join('');

  container.innerHTML = `
    <div style="max-width:760px">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:20px">Informations de l'entité</h3>

      <!-- ── Identité ──────────────────────────────────────────────── -->
      <div style="background:white;border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:16px">
        <h4 style="font-size:13px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px">📛 Identité</h4>

        <div ${blockStyle}>
          <label ${labelStyle}>Nom de l'entité *</label>
          <input id="cfg-nom" type="text" value="${data.nom||''}" ${ro} ${inputStyle}/>
        </div>

        <div style="display:grid;grid-template-columns:1fr 2fr;gap:12px;margin-bottom:12px">
          <div>
            <label ${labelStyle}>Sigle</label>
            <input id="cfg-sigle" type="text" maxlength="20" value="${data.sigle||''}" ${ro} ${inputStyle}/>
          </div>
          <div>
            <label ${labelStyle}>Forme juridique</label>
            <select id="cfg-forme" ${roSel} ${inputStyle}>
              <option value="">— Sélectionner —</option>
              ${optsFJ}
            </select>
          </div>
        </div>

        <div ${blockStyle}>
          <label ${labelStyle}>Activité principale</label>
          <input id="cfg-activite" type="text" value="${data.activite||''}" ${ro} ${inputStyle} placeholder="Ex : Commerce général de produits divers"/>
        </div>

        <div ${blockStyle}>
          <label ${labelStyle}>Nom du dirigeant</label>
          <input id="cfg-dirigeant" type="text" value="${data.dirigeant_nom||''}" ${ro} ${inputStyle}/>
        </div>
      </div>

      <!-- ── Coordonnées ───────────────────────────────────────────── -->
      <div style="background:white;border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:16px">
        <h4 style="font-size:13px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px">📍 Coordonnées</h4>

        <div ${blockStyle}>
          <label ${labelStyle}>Adresse</label>
          <input id="cfg-adresse" type="text" value="${data.adresse||''}" ${ro} ${inputStyle} placeholder="Ex : Avenue Kennedy, Yaoundé"/>
        </div>

        <div ${blockStyle}>
          <label ${labelStyle}>Boîte postale</label>
          <input id="cfg-bp" type="text" value="${data.boite_postale||''}" ${ro} ${inputStyle} placeholder="Ex : BP 1234"/>
        </div>
      </div>

      <!-- ── Identifiants légaux ───────────────────────────────────── -->
      <div style="background:white;border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:16px">
        <h4 style="font-size:13px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px">🏛️ Identifiants légaux</h4>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <label ${labelStyle}>Registre de commerce (RCCM)</label>
            <input id="cfg-rccm" type="text" value="${data.registre_commerce||''}" ${ro} ${inputStyle} placeholder="Ex : RC/YDE/2024/B/123"/>
          </div>
          <div>
            <label ${labelStyle}>NUI (Numéro Identifiant Unique)</label>
            <input id="cfg-nui" type="text" maxlength="20" value="${data.nui||''}" ${ro} ${inputStyle} placeholder="Ex : M050000123456P"/>
          </div>
        </div>
      </div>

      <!-- ── Paramètres comptables ─────────────────────────────────── -->
      <div style="background:white;border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:16px">
        <h4 style="font-size:13px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px">💰 Paramètres</h4>

        <label ${labelStyle}>Devise</label>
        <select id="cfg-devise" ${roSel} ${inputStyle}>
          <option value="FCFA" ${data.devise==='FCFA'?'selected':''}>FCFA (XAF)</option>
          <option value="EUR"  ${data.devise==='EUR' ?'selected':''}>Euro (€)</option>
          <option value="USD"  ${data.devise==='USD' ?'selected':''}>Dollar ($)</option>
        </select>

        ${canEdit ? `<div style="margin-top:18px"><button class="btn-add" onclick="saveConfig()">💾 Enregistrer la configuration</button></div>` : ''}
      </div>

      <!-- ── Changement mot de passe ───────────────────────────────── -->
      <div style="background:white;border:1px solid var(--border);border-radius:12px;padding:24px">
        <h4 style="font-size:14px;font-weight:600;margin-bottom:14px">🔑 Changer mon mot de passe</h4>
        <label ${labelStyle}>Ancien mot de passe</label>
        <input id="pwd-ancien" type="password" ${inputStyle} style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:7px;font-size:13px;margin-bottom:10px"/>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <label ${labelStyle}>Nouveau</label>
            <input id="pwd-nouveau" type="password" ${inputStyle}/>
          </div>
          <div>
            <label ${labelStyle}>Confirmer</label>
            <input id="pwd-confirm" type="password" ${inputStyle}/>
          </div>
        </div>
        <div id="pwd-err" class="alert-err" style="display:none;margin-bottom:10px"></div>
        <button class="btn-add" style="background:var(--accent-purple)" onclick="changePassword()">🔑 Modifier</button>
      </div>
    </div>`;
};

window.saveConfig = async () => {
  const payload = {
    nom:               $('cfg-nom').value.trim(),
    sigle:             $('cfg-sigle').value.trim(),
    forme_juridique:   $('cfg-forme').value,
    activite:          $('cfg-activite').value.trim(),
    dirigeant_nom:     $('cfg-dirigeant').value.trim(),
    adresse:           $('cfg-adresse').value.trim(),
    boite_postale:     $('cfg-bp').value.trim(),
    registre_commerce: $('cfg-rccm').value.trim(),
    nui:               $('cfg-nui').value.trim(),
    devise:            $('cfg-devise').value,
  };
  if (!payload.nom) { toast("Le nom de l'entité est obligatoire.", 'error'); return; }

  const res = await api.put('/config', payload);
  if (res.error) { toast(res.error, 'error'); return; }
  $('tenant-badge').textContent = res.config?.nom    || state.user.tenantNom;
  $('devise-badge').textContent = res.config?.devise || 'FCFA';
  toast('Configuration enregistrée ✓', 'success');
};
window.changePassword=async()=>{
  const ancien=$('pwd-ancien').value,nouveau=$('pwd-nouveau').value,confirm=$('pwd-confirm').value,errEl=$('pwd-err');
  if(!ancien||!nouveau||nouveau.length<6){errEl.textContent='Minimum 6 caractères.';errEl.style.display='block';return;}
  if(nouveau!==confirm){errEl.textContent='Mots de passe différents.';errEl.style.display='block';return;}
  const res=await api.post('/auth/change-password',{ancienPassword:ancien,nouveauPassword:nouveau});
  if(res.error){errEl.textContent=res.error;errEl.style.display='block';return;}
  errEl.style.display='none';$('pwd-ancien').value=$('pwd-nouveau').value=$('pwd-confirm').value='';
  toast('Mot de passe modifié ✓','success');
};

// ── PERMISSIONS ───────────────────────────────────────────────────────────
const MODULE_META = {
  journal:        { label: 'Journal de caisse',  color: '#dbeafe', text: '#1d4ed8' },
  budget:         { label: 'Suivi budgétaire',   color: '#dcfce7', text: '#15803d' },
  previsions:     { label: 'Prévisions',          color: '#fef9c3', text: '#a16207' },
  appel_fonds:    { label: 'Appel de fonds',      color: '#fce7f3', text: '#be185d' },
  rubriques:      { label: 'Rubriques',           color: '#ede9fe', text: '#7c3aed' },
  users:          { label: 'Utilisateurs',        color: '#ffedd5', text: '#c2410c' },
  config:         { label: 'Configuration',       color: '#e0f2fe', text: '#0369a1' },
  rapport:        { label: 'Rapports',            color: '#f0fdf4', text: '#166534' },
  plan_comptable: { label: 'Plan comptable',      color: '#fdf4ff', text: '#86198f' },
};

const loadPermissions = async () => {
  const container = $('permissions-content');
  const isSuperAdmin = state.user?.role === 'super_admin';
  const perms = await api.get('/permissions');
  if (perms.error) { container.innerHTML = `<div class="alert-err">${perms.error}</div>`; return; }

  // Groupement par module
  const byModule = {};
  perms.forEach(p => { if (!byModule[p.module]) byModule[p.module] = []; byModule[p.module].push(p); });

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <div>
        <h2 style="font-size:18px;font-weight:700;margin:0">Permissions</h2>
        <span style="font-size:13px;color:var(--text-muted)">${perms.length} permission${perms.length>1?'s':''} · ${Object.keys(byModule).length} modules</span>
      </div>
      ${isSuperAdmin ? `<button class="btn-add" onclick="openModalNewPerm()" style="display:flex;align-items:center;gap:6px;padding:9px 18px;font-size:13px">
        <span style="font-size:16px;line-height:1">+</span> Nouvelle permission
      </button>` : ''}
    </div>
    ${Object.entries(byModule).map(([mod, list]) => {
      const meta = MODULE_META[mod] || { label: mod, color: '#f1f5f9', text: '#64748b' };
      return `
        <div style="margin-bottom:28px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <span style="background:${meta.color};color:${meta.text};padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${meta.label}</span>
            <span style="font-size:12px;color:var(--text-muted)">${list.length} permission${list.length>1?'s':''}</span>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Nom / Code</th><th>Module</th><th>Description</th>${isSuperAdmin?'<th style="width:80px">Actions</th>':''}</tr></thead>
            <tbody>${list.map(p => `
              <tr>
                <td>
                  <div style="font-weight:700;font-size:13px;color:var(--accent);margin-bottom:2px">${p.nom}</div>
                  <code style="font-size:11px;color:var(--text-muted);background:#f1f5f9;padding:1px 6px;border-radius:4px">${p.code}</code>
                </td>
                <td><span style="background:${meta.color};color:${meta.text};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">${mod}</span></td>
                <td style="font-size:13px;color:var(--text-secondary)">${p.description||'—'}</td>
                ${isSuperAdmin ? `<td>
                  <div style="display:flex;gap:6px;flex-wrap:wrap">
                    <button onclick="openModalEditPerm('${p.code}','${p.nom.replace(/'/g,"\\'")}','${p.module}','${(p.description||'').replace(/'/g,"\\'")}')
                      " title="Modifier" style="display:inline-flex;align-items:center;gap:5px;background:#eef2ff;border:1.5px solid #c7d2fe;border-radius:8px;padding:5px 12px;cursor:pointer;color:#4f46e5;font-size:12px;font-weight:600;transition:all .15s"
                      onmouseover="this.style.background='#e0e7ff'" onmouseout="this.style.background='#eef2ff'">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      Modifier
                    </button>
                    <button onclick="deletePerm('${p.code}')" title="Supprimer"
                      style="display:inline-flex;align-items:center;gap:5px;background:#fff1f2;border:1.5px solid #fecdd3;border-radius:8px;padding:5px 12px;cursor:pointer;color:#e11d48;font-size:12px;font-weight:600;transition:all .15s"
                      onmouseover="this.style.background='#ffe4e6'" onmouseout="this.style.background='#fff1f2'">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                      Supprimer
                    </button>
                  </div>
                </td>` : ''}
              </tr>`).join('')}
            </tbody>
          </table></div>
        </div>`;
    }).join('')}`;
};

window.openModalNewPerm = () => {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-perm" onclick="if(event.target===this)closeModalPerm()">
      <div class="modal-box" style="max-width:500px">
        <div class="modal-head"><h3>🔐 Nouvelle permission</h3><button class="modal-close" onclick="closeModalPerm()">✕</button></div>
        <div class="modal-body">
          <div class="form-section">
            <label>Nom <span class="req">*</span></label>
            <input type="text" id="pm-nom" placeholder="Ex: Créer un mouvement" maxlength="200"/>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="form-section">
              <label>Code <span class="req">*</span></label>
              <input type="text" id="pm-code" placeholder="journal.create" style="font-family:monospace"/>
              <span class="field-hint">Format : module.action</span>
            </div>
            <div class="form-section">
              <label>Module <span class="req">*</span></label>
              <select id="pm-module">
                ${Object.entries(MODULE_META).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}
                <option value="autre">Autre</option>
              </select>
            </div>
          </div>
          <div class="form-section">
            <label>Description</label>
            <input type="text" id="pm-desc" placeholder="Courte description de ce que permet cette permission" maxlength="300"/>
          </div>
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalPerm()">Annuler</button>
          <button class="btn-add" id="pm-save-btn" onclick="savePerm()">Créer</button>
        </div>
      </div>
    </div>`);
  setTimeout(()=>document.getElementById('pm-nom')?.focus(), 80);
};

window.openModalEditPerm = (code, nom, module, description) => {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-perm" onclick="if(event.target===this)closeModalPerm()">
      <div class="modal-box" style="max-width:500px">
        <div class="modal-head"><h3>✎ Modifier la permission</h3><button class="modal-close" onclick="closeModalPerm()">✕</button></div>
        <div class="modal-body">
          <div class="form-section">
            <label>Code (immuable)</label>
            <input type="text" value="${code}" readonly style="background:#f8fafc;font-family:monospace"/>
          </div>
          <div class="form-section">
            <label>Nom <span class="req">*</span></label>
            <input type="text" id="pm-nom" value="${nom}" maxlength="200"/>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="form-section">
              <label>Module <span class="req">*</span></label>
              <select id="pm-module">
                ${Object.entries(MODULE_META).map(([k,v])=>`<option value="${k}" ${k===module?'selected':''}>${v.label}</option>`).join('')}
                <option value="autre" ${module==='autre'?'selected':''}>Autre</option>
              </select>
            </div>
            <div class="form-section">
              <label>Description</label>
              <input type="text" id="pm-desc" value="${description}" maxlength="300"/>
            </div>
          </div>
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalPerm()">Annuler</button>
          <button class="btn-add" id="pm-save-btn" onclick="updatePerm('${code}')">Enregistrer</button>
        </div>
      </div>
    </div>`);
};

window.closeModalPerm = () => document.getElementById('modal-perm')?.remove();

window.savePerm = async () => {
  const nom    = document.getElementById('pm-nom')?.value.trim();
  const code   = document.getElementById('pm-code')?.value.trim();
  const module = document.getElementById('pm-module')?.value;
  const description = document.getElementById('pm-desc')?.value.trim();
  if (!nom || !code || !module) { toast('Nom, code et module sont obligatoires.','error'); return; }
  const btn = document.getElementById('pm-save-btn');
  if (btn) { btn.disabled=true; btn.textContent='Création…'; }
  const res = await api.post('/permissions', { nom, code, module, description });
  if (res.error) { toast(res.error,'error'); if(btn){btn.disabled=false;btn.textContent='Créer';} return; }
  toast(`Permission "${nom}" créée.`,'success');
  closeModalPerm();
  await loadPermissions();
};

window.updatePerm = async (code) => {
  const nom    = document.getElementById('pm-nom')?.value.trim();
  const module = document.getElementById('pm-module')?.value;
  const description = document.getElementById('pm-desc')?.value.trim();
  if (!nom || !module) { toast('Nom et module sont obligatoires.','error'); return; }
  const btn = document.getElementById('pm-save-btn');
  if (btn) { btn.disabled=true; btn.textContent='Enregistrement…'; }
  const res = await api.put(`/permissions/${encodeURIComponent(code)}`, { nom, module, description });
  if (res.error) { toast(res.error,'error'); if(btn){btn.disabled=false;btn.textContent='Enregistrer';} return; }
  toast('Permission mise à jour.','success');
  closeModalPerm();
  await loadPermissions();
};

window.deletePerm = async (code) => {
  if (!confirm(`Supprimer la permission "${code}" ? Cette action est irréversible.`)) return;
  const res = await api.delete(`/permissions/${encodeURIComponent(code)}`);
  if (res.error) { toast(res.error,'error'); return; }
  toast('Permission supprimée.','success');
  await loadPermissions();
};

// ── Modal permissions par tenant ──────────────────────────────────────────
window.openModalTenantPerms = async (tenantId, tenantNom) => {
  const [allPerms, granted] = await Promise.all([
    api.get('/permissions'),
    api.get(`/tenants/${tenantId}/permissions`),
  ]);
  if (allPerms.error) { toast(allPerms.error,'error'); return; }
  const grantedSet = new Set(Array.isArray(granted) ? granted : []);
  const byModule = {};
  allPerms.forEach(p => { if (!byModule[p.module]) byModule[p.module] = []; byModule[p.module].push(p); });
  const total = allPerms.length;
  const active = allPerms.filter(p => grantedSet.has(p.code)).length;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-tenant-perms" onclick="if(event.target===this)closeModalTenantPerms()">
      <div class="modal-box" style="max-width:660px">
        <div class="modal-head" style="background:linear-gradient(135deg,#1e40af,#3b82f6);border-radius:14px 14px 0 0">
          <div>
            <h3 style="color:white;margin:0;font-size:16px">🔐 Permissions — ${tenantNom}</h3>
            <p style="color:rgba(255,255,255,.7);font-size:12px;margin:2px 0 0">${active} / ${total} fonctionnalités activées</p>
          </div>
          <button class="modal-close" onclick="closeModalTenantPerms()" style="color:white;opacity:.8">✕</button>
        </div>
        <div class="modal-body" style="padding:18px 20px;max-height:70vh;overflow-y:auto">
          ${Object.entries(byModule).map(([mod, list]) => _renderPermModule(mod, list, grantedSet, 'tp')).join('')}
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalTenantPerms()">Annuler</button>
          <button class="btn-add" id="tp-save-btn" onclick="saveTenantPerms('${tenantId}')"
            style="display:inline-flex;align-items:center;gap:6px">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Enregistrer
          </button>
        </div>
      </div>
    </div>`);
};

window.closeModalTenantPerms = () => document.getElementById('modal-tenant-perms')?.remove();

// ── Moteur commun de rendu des chips permissions ───────────────────────────
const _renderPermChip = (p, isOn, prefix, meta) => {
  const bg = meta.color, tc = meta.text;
  return `<button
    class="perm-chip-btn"
    data-perm="${p.code}" data-prefix="${prefix}" data-on="${isOn?'1':'0'}"
    data-bg="${bg}" data-text="${tc}"
    onclick="togglePermChipBtn(this)"
    style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border-radius:9px;cursor:pointer;
           font-size:12px;font-weight:600;text-align:left;transition:all .15s;
           background:${isOn?bg:'#f8fafc'};color:${isOn?tc:'#94a3b8'};
           border:1.5px solid ${isOn?tc+'55':'#e2e8f0'}">
    <span class="pcc-icon" style="width:17px;height:17px;border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;
      background:${isOn?tc:'#e2e8f0'};color:white;transition:all .15s">${isOn?'✓':''}</span>
    <span style="line-height:1.3">${p.nom}</span>
  </button>`;
};

const _renderPermModule = (mod, list, grantedSet, prefix) => {
  const meta = MODULE_META[mod] || { label: mod, color: '#f1f5f9', text: '#64748b' };
  const allOn = list.every(p => grantedSet.has(p.code));
  return `
    <div style="margin-bottom:14px;border:1.5px solid ${meta.text}22;border-radius:12px;overflow:hidden">
      <div style="background:${meta.color};padding:9px 14px;display:flex;align-items:center;justify-content:space-between">
        <span style="color:${meta.text};font-weight:800;font-size:11px;text-transform:uppercase;letter-spacing:.8px">${meta.label}</span>
        <button
          data-sa-prefix="${prefix}" data-sa-mod="${mod}"
          data-all="${allOn?'1':'0'}" data-bg="${meta.color}" data-text="${meta.text}"
          onclick="toggleAllPerms(this)"
          style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;cursor:pointer;
                 font-size:11px;font-weight:700;transition:all .15s;
                 background:${allOn?meta.text+'22':'transparent'};color:${meta.text};
                 border:1.5px solid ${allOn?meta.text+'44':meta.text+'33'}">
          <span class="sa-icon" style="font-size:10px">${allOn?'✓ Désélectionner':'Sélectionner'}</span> tout
        </button>
      </div>
      <div style="padding:10px 12px;display:grid;grid-template-columns:1fr 1fr;gap:7px;background:white">
        ${list.map(p => _renderPermChip(p, grantedSet.has(p.code), prefix, meta)).join('')}
      </div>
    </div>`;
};

window.togglePermChipBtn = (btn) => {
  const isOn = btn.dataset.on === '1';
  const newOn = !isOn;
  _setChipState(btn, newOn);
  const mod = btn.dataset.perm.split('.')[0];
  _syncSelectAll(btn.dataset.prefix, mod);
};

const _setChipState = (btn, on) => {
  const bg = btn.dataset.bg, tc = btn.dataset.text;
  btn.dataset.on = on ? '1' : '0';
  btn.style.background = on ? bg : '#f8fafc';
  btn.style.color = on ? tc : '#94a3b8';
  btn.style.borderColor = on ? tc + '55' : '#e2e8f0';
  const icon = btn.querySelector('.pcc-icon');
  if (icon) { icon.style.background = on ? tc : '#e2e8f0'; icon.textContent = on ? '✓' : ''; }
};

const _syncSelectAll = (prefix, mod) => {
  const chips = [...document.querySelectorAll(`.perm-chip-btn[data-prefix="${prefix}"]`)]
    .filter(b => b.dataset.perm.startsWith(mod + '.'));
  const allOn = chips.length > 0 && chips.every(b => b.dataset.on === '1');
  const saBtn = document.querySelector(`[data-sa-prefix="${prefix}"][data-sa-mod="${mod}"]`);
  if (!saBtn) return;
  const tc = saBtn.dataset.text;
  saBtn.dataset.all = allOn ? '1' : '0';
  saBtn.style.background = allOn ? tc + '22' : 'transparent';
  saBtn.style.borderColor = allOn ? tc + '44' : tc + '33';
  const icon = saBtn.querySelector('.sa-icon');
  if (icon) icon.textContent = allOn ? '✓ Désélectionner' : 'Sélectionner';
};

window.toggleAllPerms = (saBtn) => {
  const prefix = saBtn.dataset.saPrefix || saBtn.getAttribute('data-sa-prefix');
  const mod = saBtn.dataset.saMod || saBtn.getAttribute('data-sa-mod');
  const newOn = (saBtn.dataset.all || '0') !== '1';
  [...document.querySelectorAll(`.perm-chip-btn[data-prefix="${prefix}"]`)]
    .filter(b => b.dataset.perm.startsWith(mod + '.'))
    .forEach(b => _setChipState(b, newOn));
  _syncSelectAll(prefix, mod);
};

window.saveTenantPerms = async (tenantId) => {
  const codes = [...document.querySelectorAll('.perm-chip-btn[data-prefix="tp"][data-on="1"]')].map(b => b.dataset.perm);
  const btn = document.getElementById('tp-save-btn');
  if (btn) { btn.disabled=true; btn.style.opacity='.6'; }
  const res = await api.post(`/tenants/${tenantId}/permissions`, { codes });
  if (res.error) { toast(res.error,'error'); if(btn){btn.disabled=false;btn.style.opacity='1';} return; }
  toast(`${codes.length} permission${codes.length>1?'s':''} enregistrée${codes.length>1?'s':''}.`,'success');
  closeModalTenantPerms();
};

// ── Modal permissions par utilisateur ─────────────────────────────────────
window.openModalUserPerms = async (userId, userName) => {
  const [allPerms, granted] = await Promise.all([
    api.get('/permissions'),
    api.get(`/users/${userId}/permissions`),
  ]);
  if (allPerms.error) { toast(allPerms.error,'error'); return; }
  const grantedSet = new Set(Array.isArray(granted) ? granted : []);
  const byModule = {};
  allPerms.forEach(p => { if (!byModule[p.module]) byModule[p.module] = []; byModule[p.module].push(p); });
  const total = allPerms.length;
  const active = allPerms.filter(p => grantedSet.has(p.code)).length;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-user-perms" onclick="if(event.target===this)closeModalUserPerms()">
      <div class="modal-box" style="max-width:660px">
        <div class="modal-head" style="background:linear-gradient(135deg,#5b21b6,#7c3aed);border-radius:14px 14px 0 0">
          <div>
            <h3 style="color:white;margin:0;font-size:16px">👤 Permissions — ${userName}</h3>
            <p style="color:rgba(255,255,255,.7);font-size:12px;margin:2px 0 0">${active} / ${total} · Permissions spécifiques à cet utilisateur</p>
          </div>
          <button class="modal-close" onclick="closeModalUserPerms()" style="color:white;opacity:.8">✕</button>
        </div>
        <div class="modal-body" style="padding:18px 20px;max-height:70vh;overflow-y:auto">
          ${Object.entries(byModule).map(([mod, list]) => _renderPermModule(mod, list, grantedSet, 'up')).join('')}
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalUserPerms()">Annuler</button>
          <button class="btn-add" id="up-save-btn" onclick="saveUserPerms('${userId}')"
            style="display:inline-flex;align-items:center;gap:6px">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Enregistrer
          </button>
        </div>
      </div>
    </div>`);
};

window.closeModalUserPerms = () => document.getElementById('modal-user-perms')?.remove();

window.saveUserPerms = async (userId) => {
  const codes = [...document.querySelectorAll('.perm-chip-btn[data-prefix="up"][data-on="1"]')].map(b => b.dataset.perm);
  const btn = document.getElementById('up-save-btn');
  if (btn) { btn.disabled=true; btn.style.opacity='.6'; }
  const res = await api.post(`/users/${userId}/permissions`, { codes });
  if (res.error) { toast(res.error,'error'); if(btn){btn.disabled=false;btn.style.opacity='1';} return; }
  toast(`${codes.length} permission${codes.length>1?'s':''} enregistrée${codes.length>1?'s':''}.`,'success');
  closeModalUserPerms();
};

// ── Tab Rôles (dans Configuration, super_admin) ───────────────────────────
const ROLE_COLORS = [
  { val:'#6366f1', label:'Indigo'  }, { val:'#0ea5e9', label:'Bleu'    },
  { val:'#10b981', label:'Vert'    }, { val:'#f59e0b', label:'Ambre'   },
  { val:'#ef4444', label:'Rouge'   }, { val:'#8b5cf6', label:'Violet'  },
  { val:'#ec4899', label:'Rose'    }, { val:'#14b8a6', label:'Turquoise'},
];

const loadTabRoles = async () => {
  const container = $('tab-roles'); if(!container) return;
  container.innerHTML = `<div class="loading-msg">Chargement des rôles…</div>`;
  const roles = await api.get('/roles');
  if(roles.error){ container.innerHTML=`<div class="alert-err">${roles.error}</div>`; return; }

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <div>
        <h3 style="font-size:16px;font-weight:700;margin:0 0 3px">Rôles personnalisés</h3>
        <span style="font-size:13px;color:var(--text-muted)">${roles.length} rôle${roles.length>1?'s':''} défini${roles.length>1?'s':''} · Créez des profils de permissions pour vos utilisateurs</span>
      </div>
      <button onclick="openModalNewRole()" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#7c3aed,#6366f1);color:white;border:none;border-radius:10px;padding:10px 20px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(99,102,241,.35);transition:all .2s"
        onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 14px rgba(99,102,241,.45)'"
        onmouseout="this.style.transform='';this.style.boxShadow='0 2px 8px rgba(99,102,241,.35)'">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nouveau rôle
      </button>
    </div>

    ${roles.length === 0 ? `
      <div style="background:white;border:2px dashed var(--border);border-radius:16px;padding:48px;text-align:center">
        <div style="font-size:48px;margin-bottom:12px">🎭</div>
        <h4 style="font-size:15px;font-weight:700;margin:0 0 8px">Aucun rôle défini</h4>
        <p style="color:var(--text-muted);font-size:13px;margin:0 0 20px">Créez des rôles comme "Caissière", "Auditeur interne" et associez-leur des permissions précises.</p>
        <button onclick="openModalNewRole()" style="background:linear-gradient(135deg,#7c3aed,#6366f1);color:white;border:none;border-radius:10px;padding:10px 24px;font-size:13px;font-weight:700;cursor:pointer">
          Créer le premier rôle
        </button>
      </div>` : `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
        ${roles.map(r => {
          const col = r.couleur || '#6366f1';
          const hex20 = col + '20';
          const hex15 = col + '15';
          return `
            <div style="background:white;border:1.5px solid var(--border);border-radius:14px;overflow:hidden;transition:box-shadow .2s;box-shadow:0 1px 4px rgba(0,0,0,.06)"
              onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.1)'"
              onmouseout="this.style.boxShadow='0 1px 4px rgba(0,0,0,.06)'">
              <div style="height:6px;background:${col}"></div>
              <div style="padding:18px 20px">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px">
                  <div style="display:flex;align-items:center;gap:10px">
                    <div style="width:42px;height:42px;border-radius:10px;background:${hex20};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🎭</div>
                    <div>
                      <div style="font-weight:700;font-size:14px;color:var(--text)">${r.nom}</div>
                      <code style="font-size:11px;color:${col};background:${hex15};padding:1px 7px;border-radius:5px;font-weight:600">${r.code}</code>
                    </div>
                  </div>
                  <div style="display:flex;gap:5px;flex-shrink:0">
                    <button onclick="openModalEditRole(${r.id},'${r.nom.replace(/'/g,"\\'")}','${r.code}','${(r.description||'').replace(/'/g,"\\'")}','${col}')"
                      style="width:30px;height:30px;border-radius:7px;border:1.5px solid #c7d2fe;background:#eef2ff;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#4f46e5;transition:all .15s"
                      title="Modifier" onmouseover="this.style.background='#e0e7ff'" onmouseout="this.style.background='#eef2ff'">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button onclick="deleteRole(${r.id},'${r.nom.replace(/'/g,"\\'")}'')"
                      style="width:30px;height:30px;border-radius:7px;border:1.5px solid #fecdd3;background:#fff1f2;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#e11d48;transition:all .15s"
                      title="Supprimer" onmouseover="this.style.background='#ffe4e6'" onmouseout="this.style.background='#fff1f2'">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>
                  </div>
                </div>
                ${r.description ? `<p style="font-size:12px;color:var(--text-muted);margin:0 0 12px;line-height:1.5">${r.description}</p>` : ''}
                <div style="display:flex;align-items:center;justify-content:space-between">
                  <div style="display:flex;align-items:center;gap:6px">
                    <span style="background:${hex20};color:${col};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">
                      ${r.nb_permissions} permission${r.nb_permissions>1?'s':''}
                    </span>
                  </div>
                  <button onclick="openModalRolePerms(${r.id},'${r.nom.replace(/'/g,"\\'")}','${col}')"
                    style="display:inline-flex;align-items:center;gap:5px;background:${hex15};border:1.5px solid ${col}40;border-radius:8px;padding:5px 12px;cursor:pointer;color:${col};font-size:12px;font-weight:700;transition:all .15s"
                    onmouseover="this.style.background='${hex20}'" onmouseout="this.style.background='${hex15}'">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Définir les permissions
                  </button>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>`}`;
};

window.openModalNewRole = () => {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-role" onclick="if(event.target===this)closeModalRole()">
      <div class="modal-box" style="max-width:480px">
        <div class="modal-head" style="background:linear-gradient(135deg,#7c3aed,#6366f1);color:white;border-radius:14px 14px 0 0">
          <h3 style="color:white;margin:0;font-size:16px">🎭 Nouveau rôle</h3>
          <button class="modal-close" onclick="closeModalRole()" style="color:white;opacity:.8">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-section">
            <label>Nom du rôle <span class="req">*</span></label>
            <input type="text" id="rl-nom" placeholder="Ex: Caissière, Auditeur interne…" maxlength="100" oninput="autoCodeRole(this.value)"/>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="form-section">
              <label>Code <span class="req">*</span></label>
              <input type="text" id="rl-code" placeholder="caissiere" style="font-family:monospace" maxlength="60"/>
              <span class="field-hint">Lettres, chiffres, _ uniquement</span>
            </div>
            <div class="form-section">
              <label>Couleur</label>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
                ${ROLE_COLORS.map((c,i) => `
                  <label style="cursor:pointer" title="${c.label}">
                    <input type="radio" name="rl-color" value="${c.val}" ${i===0?'checked':''} style="display:none"/>
                    <span style="display:block;width:22px;height:22px;border-radius:50%;background:${c.val};border:2px solid transparent;transition:border-color .15s"
                      onclick="document.querySelectorAll('[name=rl-color]').forEach(r=>{r.parentElement.querySelector('span').style.borderColor='transparent'});this.style.borderColor='#1e293b'"></span>
                  </label>`).join('')}
              </div>
            </div>
          </div>
          <div class="form-section">
            <label>Description</label>
            <input type="text" id="rl-desc" placeholder="Courte description du rôle…" maxlength="300"/>
          </div>
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalRole()">Annuler</button>
          <button id="rl-save-btn" onclick="saveNewRole()"
            style="background:linear-gradient(135deg,#7c3aed,#6366f1);color:white;border:none;border-radius:10px;padding:9px 22px;font-size:13px;font-weight:700;cursor:pointer">
            Créer le rôle
          </button>
        </div>
      </div>
    </div>`);
  setTimeout(()=>document.getElementById('rl-nom')?.focus(), 80);
  // highlight first color
  document.querySelector('[name="rl-color"]')?.parentElement?.querySelector('span')?.style.setProperty('border-color','#1e293b');
};

window.autoCodeRole = (nom) => {
  const input = document.getElementById('rl-code');
  if(!input) return;
  input.value = nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
};

window.openModalEditRole = (id, nom, code, description, couleur) => {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-role" onclick="if(event.target===this)closeModalRole()">
      <div class="modal-box" style="max-width:480px">
        <div class="modal-head" style="background:linear-gradient(135deg,#7c3aed,#6366f1);color:white;border-radius:14px 14px 0 0">
          <h3 style="color:white;margin:0;font-size:16px">✏️ Modifier le rôle</h3>
          <button class="modal-close" onclick="closeModalRole()" style="color:white;opacity:.8">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-section">
            <label>Code (immuable)</label>
            <input type="text" value="${code}" readonly style="background:#f8fafc;font-family:monospace;color:var(--text-muted)"/>
          </div>
          <div class="form-section">
            <label>Nom du rôle <span class="req">*</span></label>
            <input type="text" id="rl-nom" value="${nom}" maxlength="100"/>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="form-section">
              <label>Couleur</label>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
                ${ROLE_COLORS.map(c => `
                  <label style="cursor:pointer" title="${c.label}">
                    <input type="radio" name="rl-color" value="${c.val}" ${c.val===couleur?'checked':''} style="display:none"/>
                    <span style="display:block;width:22px;height:22px;border-radius:50%;background:${c.val};border:2px solid ${c.val===couleur?'#1e293b':'transparent'};transition:border-color .15s"
                      onclick="document.querySelectorAll('[name=rl-color]').forEach(r=>{r.parentElement.querySelector('span').style.borderColor='transparent'});this.style.borderColor='#1e293b'"></span>
                  </label>`).join('')}
              </div>
            </div>
            <div class="form-section">
              <label>Description</label>
              <input type="text" id="rl-desc" value="${description}" maxlength="300"/>
            </div>
          </div>
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalRole()">Annuler</button>
          <button id="rl-save-btn" onclick="updateRole(${id})"
            style="background:linear-gradient(135deg,#7c3aed,#6366f1);color:white;border:none;border-radius:10px;padding:9px 22px;font-size:13px;font-weight:700;cursor:pointer">
            Enregistrer
          </button>
        </div>
      </div>
    </div>`);
  setTimeout(()=>document.getElementById('rl-nom')?.focus(), 80);
};

window.closeModalRole = () => document.getElementById('modal-role')?.remove();

window.saveNewRole = async () => {
  const nom  = document.getElementById('rl-nom')?.value.trim();
  const code = document.getElementById('rl-code')?.value.trim();
  const desc = document.getElementById('rl-desc')?.value.trim();
  const col  = document.querySelector('input[name="rl-color"]:checked')?.value || '#6366f1';
  if(!nom || !code){ toast('Nom et code obligatoires.','error'); return; }
  const btn = document.getElementById('rl-save-btn');
  if(btn){ btn.disabled=true; btn.textContent='Création…'; }
  const res = await api.post('/roles', { nom, code, description: desc, couleur: col });
  if(res.error){ toast(res.error,'error'); if(btn){btn.disabled=false;btn.textContent='Créer le rôle';} return; }
  toast(`Rôle "${nom}" créé avec succès.`,'success');
  closeModalRole();
  loadTabRoles();
};

window.updateRole = async (id) => {
  const nom  = document.getElementById('rl-nom')?.value.trim();
  const desc = document.getElementById('rl-desc')?.value.trim();
  const col  = document.querySelector('input[name="rl-color"]:checked')?.value || '#6366f1';
  if(!nom){ toast('Le nom est obligatoire.','error'); return; }
  const btn = document.getElementById('rl-save-btn');
  if(btn){ btn.disabled=true; btn.textContent='Enregistrement…'; }
  const res = await api.put(`/roles/${id}`, { nom, description: desc, couleur: col });
  if(res.error){ toast(res.error,'error'); if(btn){btn.disabled=false;btn.textContent='Enregistrer';} return; }
  toast('Rôle mis à jour.','success');
  closeModalRole();
  loadTabRoles();
};

window.deleteRole = async (id, nom) => {
  if(!confirm(`Supprimer le rôle "${nom}" ? Ses permissions associées seront perdues.`)) return;
  const res = await api.delete(`/roles/${id}`);
  if(res.error){ toast(res.error,'error'); return; }
  toast('Rôle supprimé.','success');
  loadTabRoles();
};

// ── Modal permissions d'un rôle ─────────────────────────────────────────────
window.openModalRolePerms = async (roleId, roleNom, couleur) => {
  const col = couleur || '#6366f1';
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modal-role-perms" onclick="if(event.target===this)closeModalRolePerms()">
      <div class="modal-box" style="max-width:640px">
        <div class="modal-head" style="background:${col};color:white;border-radius:14px 14px 0 0">
          <div>
            <h3 style="color:white;margin:0;font-size:16px">🔐 Permissions — ${roleNom}</h3>
            <p style="color:rgba(255,255,255,.75);font-size:12px;margin:2px 0 0">Définissez les fonctionnalités accessibles pour ce rôle</p>
          </div>
          <button class="modal-close" onclick="closeModalRolePerms()" style="color:white;opacity:.8">✕</button>
        </div>
        <div class="modal-body" style="padding:20px 24px" id="rp-body">
          <div class="loading-msg">Chargement…</div>
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalRolePerms()">Annuler</button>
          <button id="rp-save-btn" onclick="saveRolePerms(${roleId})"
            style="background:${col};color:white;border:none;border-radius:10px;padding:9px 22px;font-size:13px;font-weight:700;cursor:pointer">
            Enregistrer les permissions
          </button>
        </div>
      </div>
    </div>`);

  const [allPerms, granted] = await Promise.all([
    api.get('/permissions'),
    api.get(`/roles/${roleId}/permissions`),
  ]);
  const body = document.getElementById('rp-body');
  if(!body) return;
  if(allPerms.error){ body.innerHTML=`<div class="alert-err">${allPerms.error}</div>`; return; }

  const grantedSet = new Set(Array.isArray(granted) ? granted : []);
  const byModule = {};
  allPerms.forEach(p => { if(!byModule[p.module]) byModule[p.module]=[]; byModule[p.module].push(p); });

  body.innerHTML = Object.entries(byModule).map(([mod, list]) => _renderPermModule(mod, list, grantedSet, 'rp')).join('');
};

window.closeModalRolePerms = () => document.getElementById('modal-role-perms')?.remove();

window.saveRolePerms = async (roleId) => {
  const codes = [...document.querySelectorAll('.perm-chip-btn[data-prefix="rp"][data-on="1"]')].map(b => b.dataset.perm);
  const btn = document.getElementById('rp-save-btn');
  if(btn){ btn.disabled=true; btn.style.opacity='.6'; }
  const res = await api.post(`/roles/${roleId}/permissions`, { codes });
  if(res.error){ toast(res.error,'error'); if(btn){btn.disabled=false;btn.style.opacity='1';} return; }
  toast(`${codes.length} permission${codes.length>1?'s':''} enregistrée${codes.length>1?'s':''}.`,'success');
  closeModalRolePerms();
  loadTabRoles();
};

// ── TENANTS ───────────────────────────────────────────────────────────────
const loadTenants = async () => {
  const container=$('tenants-content');
  const tenants=await api.get('/tenants');
  if(tenants.error){container.innerHTML=`<div class="alert-err">${tenants.error}</div>`;return;}
  const isSuperAdmin = state.user?.role === 'super_admin';
  container.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div>
        <h2 style="font-size:18px;font-weight:700;margin:0">Clients</h2>
        <span style="font-size:13px;color:var(--text-muted)">${tenants.length} client${tenants.length>1?'s':''} enregistré${tenants.length>1?'s':''}</span>
      </div>
      ${isSuperAdmin?`<button class="btn-add" onclick="openModalNewTenant()" style="display:flex;align-items:center;gap:6px;padding:9px 18px;font-size:13px">
        <span style="font-size:16px;line-height:1">+</span> Nouveau client
      </button>`:''}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Client</th><th>Identifiant</th><th>Statut</th><th>Créé le</th><th>Action</th></tr></thead>
      <tbody>${tenants.map(t=>{
        const isActive=t.id===state.activeTenantId;
        return `<tr style="${isActive?'background:#eff6ff':''}">
          <td><div style="display:flex;align-items:center;gap:10px">
            <div style="width:36px;height:36px;border-radius:10px;background:${isActive?'var(--accent)':'#e2e8f0'};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:${isActive?'white':'var(--text-muted)'};flex-shrink:0">
              ${t.nom.substring(0,2).toUpperCase()}</div>
            <div>
              <div style="font-weight:700;font-size:14px">${t.nom}</div>
              ${isActive?'<span style="font-size:10px;background:#dbeafe;color:#1d4ed8;padding:1px 7px;border-radius:10px;font-weight:600">EN COURS</span>':''}
            </div>
          </div></td>
          <td><span class="badge-rubrique" style="font-family:monospace;font-size:12px">${t.slug}</span></td>
          <td>
            <span class="statut-badge ${t.actif?'statut-valide':'statut-rejete'}">${t.actif?'✓ Actif':'✗ Inactif'}</span>
            ${isSuperAdmin?`<button onclick="toggleTenantActif('${t.id}',${t.actif})"
              style="margin-left:6px;font-size:10px;padding:2px 8px;border:1px solid ${t.actif?'#fca5a5':'#86efac'};border-radius:6px;background:white;cursor:pointer;color:${t.actif?'#dc2626':'#16a34a'};font-weight:600">
              ${t.actif?'Désactiver':'Activer'}</button>`:''}
          </td>
          <td style="font-size:12px;color:var(--text-muted)">${new Date(t.created_at).toLocaleDateString('fr-FR')}</td>
          <td>
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
              ${isActive?'<span style="font-size:12px;color:var(--accent);font-weight:600">✓ Sélectionné</span>'
                :`<button class="btn-add" style="font-size:12px;padding:5px 12px"
                   onclick="switchTenant('${t.id}','${t.nom.replace(/'/g,"\\'")}')">Travailler sur ce client</button>`}
              ${isSuperAdmin?`<button onclick="openModalTenantPerms('${t.id}','${t.nom.replace(/'/g,"\\'")}')
                " style="font-size:11px;padding:4px 10px;border:1px solid #c7d2fe;border-radius:6px;background:#eef2ff;color:#4f46e5;cursor:pointer;font-weight:600">🔐 Permissions</button>`:''}
            </div>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
};

window.openModalNewTenant = () => {
  document.body.insertAdjacentHTML('beforeend',`
    <div class="modal-overlay" id="modal-new-tenant" onclick="if(event.target===this)closeModalNewTenant()">
      <div class="modal-box" style="max-width:540px">
        <div class="modal-head">
          <h3>🏢 Nouveau client</h3>
          <button class="modal-close" onclick="closeModalNewTenant()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-section">
            <label>Nom du client <span class="req">*</span></label>
            <input type="text" id="nt-nom" placeholder="Ex: Cabinet Dupont" maxlength="100"
              oninput="autoSlugTenant(this.value)"/>
          </div>
          <div class="form-section">
            <label>Identifiant unique (slug) <span class="req">*</span></label>
            <input type="text" id="nt-slug" placeholder="cabinet-dupont" maxlength="60"
              style="font-family:monospace"/>
            <span class="field-hint">Minuscules, chiffres et tirets uniquement — immuable après création.</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="form-section">
              <label>Nom du caissier</label>
              <input type="text" id="nt-caissier" placeholder="Ex: Marie Nguema" maxlength="100"/>
            </div>
            <div class="form-section">
              <label>Nom du directeur</label>
              <input type="text" id="nt-directeur" placeholder="Ex: Jean Ngan" maxlength="100"/>
            </div>
          </div>
          <div class="form-section">
            <label>Devise</label>
            <select id="nt-devise">
              <option value="FCFA" selected>FCFA — Franc CFA</option>
              <option value="XAF">XAF — Franc CFA (BEAC)</option>
              <option value="EUR">EUR — Euro</option>
              <option value="USD">USD — Dollar américain</option>
            </select>
          </div>
        </div>
        <div class="modal-foot" style="gap:10px">
          <button class="btn-secondary" onclick="closeModalNewTenant()">Annuler</button>
          <button class="btn-add" id="nt-save-btn" onclick="saveNewTenant()">Créer le client</button>
        </div>
      </div>
    </div>`);
  setTimeout(()=>document.getElementById('nt-nom')?.focus(),80);
};

window.autoSlugTenant = (val) => {
  const slug = val.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'');
  const el = document.getElementById('nt-slug');
  if(el) el.value = slug;
};

window.closeModalNewTenant = () => document.getElementById('modal-new-tenant')?.remove();

window.saveNewTenant = async () => {
  const nom          = document.getElementById('nt-nom')?.value.trim();
  const slug         = document.getElementById('nt-slug')?.value.trim();
  const caissier_nom = document.getElementById('nt-caissier')?.value.trim();
  const directeur_nom= document.getElementById('nt-directeur')?.value.trim();
  const devise       = document.getElementById('nt-devise')?.value || 'FCFA';
  if(!nom)  { toast('Le nom du client est obligatoire.','error'); return; }
  if(!slug) { toast("L'identifiant (slug) est obligatoire.",'error'); return; }
  if(!/^[a-z0-9-]+$/.test(slug)) { toast('Slug invalide : minuscules, chiffres et tirets uniquement.','error'); return; }
  const btn = document.getElementById('nt-save-btn');
  if(btn){ btn.disabled=true; btn.textContent='Création…'; }
  const res = await api.post('/tenants',{nom,slug,caissier_nom,directeur_nom,devise});
  if(res.error){
    toast(res.error,'error');
    if(btn){ btn.disabled=false; btn.textContent='Créer le client'; }
    return;
  }
  toast(`Client "${nom}" créé avec succès !`,'success');
  closeModalNewTenant();
  await loadTenants();
};

window.toggleTenantActif = async (id, currentActif) => {
  const res = await api.patch(`/tenants/${id}/actif`,{ actif: !currentActif });
  if(res.error){ toast(res.error,'error'); return; }
  await loadTenants();
};

// ── SÉLECTEUR TENANT ──────────────────────────────────────────────────────
window.switchTenant=async(tenantId,tenantNom)=>{
  state.activeTenantId=tenantId; state.activeTenantNom=tenantNom;
  $('tenant-badge').textContent=tenantNom;
  await loadRubriques(); await loadJournaux();
  toast(`Client : ${tenantNom}`,'success');
  await showPage(state.currentPage);
};

window.showTenantSelector=async()=>{
  const tenants=await api.get('/tenants');
  if(!Array.isArray(tenants)||tenants.length===0){toast('Aucun client trouvé.','error');return;}
  const html=`
    <div class="modal-overlay" id="modal-tenant-select" style="background:rgba(10,20,40,.85)">
      <div class="modal-box" style="max-width:500px">
        <div class="modal-head"><h3>🏢 Sélectionner un client</h3></div>
        <div class="modal-body" style="padding:12px 24px 20px">
          ${tenants.filter(t=>t.actif).map(t=>`
            <div onclick="selectTenantClose('${t.id}','${t.nom.replace(/'/g,"\\'")}','${t.devise||'FCFA'}')"
              style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:10px;
                border:1.5px solid var(--border);margin-bottom:8px;cursor:pointer;background:white;transition:all .12s"
              onmouseover="this.style.borderColor='var(--accent)';this.style.background='#eff6ff'"
              onmouseout="this.style.borderColor='var(--border)';this.style.background='white'">
              <div style="width:40px;height:40px;border-radius:10px;background:#dbeafe;display:flex;
                align-items:center;justify-content:center;font-size:16px;font-weight:800;color:var(--accent);flex-shrink:0">
                ${t.nom.substring(0,2).toUpperCase()}</div>
              <div style="flex:1">
                <div style="font-weight:700;font-size:14px">${t.nom}</div>
                <div style="font-size:11px;color:var(--text-muted)">${t.slug} · ${t.devise||'FCFA'}</div>
              </div>
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--text-light)" fill="none" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
};
window.selectTenantClose=async(id,nom,devise)=>{
  state.activeTenantId=id; state.activeTenantNom=nom;
  $('tenant-badge').textContent=nom; $('devise-badge').textContent=devise;
  const m=$('modal-tenant-select'); if(m)m.remove();
  await loadRubriques(); await loadJournaux();
  await showPage('dashboard');
};

// ── PWA ───────────────────────────────────────────────────────────────────
window.installPWA=async()=>{
  if(!window._pwaInstallPrompt){toast('Non disponible sur ce navigateur.','');return;}
  window._pwaInstallPrompt.prompt();
  await window._pwaInstallPrompt.userChoice;
  window._pwaInstallPrompt=null;
};

window.openSyncPage=async()=>{
  const ops=await SyncManager.getAll();
  const html=`
    <div class="modal-overlay" id="modal-sync" onclick="if(event.target===this)closeModalSync()">
      <div class="modal-box" style="max-width:680px">
        <div class="modal-head"><h3>🔄 File de synchronisation</h3>
          <button class="modal-close" onclick="closeModalSync()">✕</button></div>
        <div class="modal-body" style="padding:16px 24px">
          <div style="display:flex;gap:10px;margin-bottom:14px">
            <span class="statut-badge statut-attente">${ops.filter(o=>o.statut==='pending').length} en attente</span>
            <span class="statut-badge statut-valide">${ops.filter(o=>o.statut==='done').length} synchronisé(s)</span>
            <span class="statut-badge statut-rejete">${ops.filter(o=>o.statut==='error').length} erreur(s)</span>
          </div>
          <div class="table-wrap" style="max-height:300px;overflow-y:auto"><table>
            <thead><tr><th>Date</th><th>Méthode</th><th>URL</th><th>Statut</th></tr></thead>
            <tbody>${ops.slice(-20).reverse().map(o=>`<tr>
              <td style="font-size:11px">${new Date(o.created_at).toLocaleString('fr-FR')}</td>
              <td><span class="badge-rubrique">${o.method}</span></td>
              <td style="font-size:11px;color:var(--text-muted)">${o.url}</td>
              <td><span class="statut-badge ${o.statut==='done'?'statut-valide':o.statut==='error'?'statut-rejete':'statut-attente'}">${o.statut}</span></td>
            </tr>`).join('')||'<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted)">Aucune opération</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="modal-foot">
          <button class="btn-ghost" onclick="SyncManager.clearDone();closeModalSync()">Vider terminés</button>
          <button class="btn-add" onclick="SyncManager.replayAll();closeModalSync()">🔄 Forcer sync</button>
        </div>
      </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
};
window.closeModalSync=()=>{const m=$('modal-sync');if(m)m.remove();};

// ── LOGIN FORM ────────────────────────────────────────────────────────────
const initLogin=()=>{
  const doLogin=async()=>{
    const username=$('inp-username').value.trim(),password=$('inp-password').value;
    const errEl=$('login-err'),btn=$('btn-login');
    if(!username||!password){errEl.textContent='Identifiant et mot de passe requis.';errEl.style.display='block';return;}
    btn.textContent='Connexion…'; btn.disabled=true; errEl.style.display='none';
    const res=await api.post('/auth/login',{username,password});
    btn.textContent='Se connecter'; btn.disabled=false;
    if(res.error){errEl.textContent=res.error;errEl.style.display='block';return;}
    saveSession(res.accessToken,res.user);
    await launchApp();
  };
  $('btn-login').addEventListener('click',doLogin);
  $('inp-password').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
};

// ── LAUNCH APP ────────────────────────────────────────────────────────────
const launchApp=async()=>{
  showScreen('screen-app');
  $('user-name').textContent   = state.user.username;
  $('user-role').textContent   = state.user.role;
  $('user-avatar').textContent = state.user.username.substring(0,2).toUpperCase();
  $('devise-badge').textContent= state.user.devise||'FCFA';

  const isAdmin=['super_admin','comptable_cabinet'].includes(state.user.role);
  $('nav-tenants').style.display     = isAdmin ? '' : 'none';
  $('nav-permissions').style.display = isAdmin ? '' : 'none';

  // Dépenses en attente : accès directeur/super_admin + badge
  const peutVoirAttente = ['directeur','super_admin'].includes(state.user.role);
  $('nav-attente').style.display = peutVoirAttente ? '' : 'none';
  if(peutVoirAttente) updateAttenteBadge();

  // Cloche de notifications : tous les rôles
  if(typeof updateNotifBadge==='function'){
    updateNotifBadge();
    if(!window._notifPoll) window._notifPoll=setInterval(()=>{ if(navigator.onLine) updateNotifBadge(); }, 45000);
  }

  initPeriod();
  restoreNavGroupState();

  document.querySelectorAll('.nav-item:not(.nav-sub)').forEach(link=>{
    link.addEventListener('click',e=>{e.preventDefault();const p=link.dataset.page;if(p)showPage(p,{sourceElement:link});});
  });
  // Nav-items sous-section (Budget, Appel fonds, Suivi budgétaire, Compte d'emploi)
  // Exclus les journaux dynamiques (gérés par selectJournal via onclick inline)
  document.querySelectorAll('.nav-item.nav-sub[data-page]:not([data-journal-id])').forEach(link=>{
    link.addEventListener('click',e=>{
      e.preventDefault();
      const p = link.dataset.page;
      const t = link.dataset.title;
      if(p) showPage(p, { sourceElement: link, customTitle: t });
    });
  });

  $('modal-close').addEventListener('click',closeModal);
  $('modal-cancel').addEventListener('click',closeModal);
  $('modal-save').addEventListener('click',saveMouvement);
  $('modal-mouvement').addEventListener('click',e=>{if(e.target===$('modal-mouvement'))closeModal();});

  $('btn-logout').addEventListener('click',()=>{if(confirm('Se déconnecter ?')){clearSession();showScreen('screen-login');}});

  const badge=$('tenant-badge');
  if(badge&&isAdmin){badge.style.cursor='pointer';badge.title='Cliquez pour changer de client';badge.addEventListener('click',showTenantSelector);}

  if(isAdmin&&!state.user.tenantId){
    $('tenant-badge').textContent='— Choisir un client —';
    await showTenantSelector();
  } else {
    $('tenant-badge').textContent=state.user.tenantNom||state.user.tenantSlug||'Cabinet';
    await loadRubriques();
    await loadJournaux();
    await showPage('dashboard');
    // Badge dépassements (pour directeurs)
    if (['directeur','super_admin'].includes(state.user?.role)) {
      api.get('/budget-caisse/depassements/count').then(r => { if(!r.error) updateDepassementsBadge(r.count); }).catch(()=>{});
    }
  }
};

// ── BOOT ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',async()=>{
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js')
      .then(reg=>{
        reg.addEventListener('updatefound',()=>{
          const sw=reg.installing;
          sw.addEventListener('statechange',()=>{
            if(sw.state==='installed'&&navigator.serviceWorker.controller)toast('Mise à jour disponible — rechargez.','');
          });
        });
      }).catch(err=>console.warn('[PWA]',err));
  }
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault(); window._pwaInstallPrompt=e;
    const btn=$('btn-install-pwa'); if(btn)btn.style.display='flex';
  });
  try{ SyncManager.init(); }catch(_){}
  initLogin();
  if(loadSession()) await launchApp();
  else showScreen('screen-login');
});
