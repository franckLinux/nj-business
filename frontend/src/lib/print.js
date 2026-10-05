// Générateurs d'impression A4 — repris de legacy/js/app.js :
// printJournalView (l. 920-1099), printJournauxRecap (l. 1102-1241),
// imprimerDemande (l. 3333-3364, technique Blob URL), printCE (l. 3870-3917,
// à l'origine un clonage DOM de #ce-printable — ici reconstruit de façon
// déclarative à partir des données de l'API, sans dépendre du rendu React).
const fmtN = (n) => (parseFloat(n) || 0).toLocaleString('fr-FR');

const TYPE_LABEL_P = { caisse: 'Caisse Espèces', om: 'Orange Money', momo: 'Mobile Money', carte_prepayee: 'Carte Prépayée', banque: 'Banque', autre: 'Autre' };
const CE_TYPE_LABEL = { caisse: 'Caisse Espèces', om: 'Orange Money', momo: 'Mobile Money', carte_prepayee: 'Carte Prépayée', autre: 'Autre' };
const CE_TYPE_ICO = { caisse: '💵', om: '📱', momo: '📲', carte_prepayee: '💳', autre: '🏦' };

// Ouvre une fenêtre et y écrit le document (technique document.write, comme
// printJournalView/printJournauxRecap/printCE en legacy).
function openPrintWindowViaWrite(html) {
  const pw = window.open('', '_blank', 'width=1200,height=850');
  if (!pw) return false;
  pw.document.write(html);
  pw.document.close();
  return true;
}

// Ouvre une fenêtre via un Blob URL (technique imprimerDemande en legacy) —
// évite document.write pour ce document plus simple, révoqué après 10s.
function openPrintWindowViaBlob(html) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (w) w.onload = () => { setTimeout(() => w.print(), 300); };
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return Boolean(w);
}

const A4_LANDSCAPE_BASE_CSS = `
  @page { size: A4 landscape; margin: 14mm 12mm 10mm; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  body{ font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#111; background:white; }
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
  .kpi-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:12px; }
  .kpi-box{ border:1px solid #e2e8f0; padding:8px 12px; border-radius:6px; }
  .kpi-label{ font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; color:#6b7280; margin-bottom:4px; }
  .kpi-value{ font-size:14px; font-weight:800; }
  .kpi-sub{ font-size:9px; color:#94a3b8; margin-top:2px; }
  .kpi-ran{ border-left:3px solid #f59e0b; } .kpi-ran .kpi-value{ color:#92400e; }
  .kpi-ent{ border-left:3px solid #16a34a; } .kpi-ent .kpi-value{ color:#15803d; }
  .kpi-sor{ border-left:3px solid #dc2626; } .kpi-sor .kpi-value{ color:#b91c1c; }
  .section-title{ font-size:11px; font-weight:700; color:#374151; margin-bottom:6px;
    border-bottom:1px solid #e2e8f0; padding-bottom:4px; display:flex; justify-content:space-between; }
  .section-count{ font-weight:400; color:#9ca3af; font-size:10px; }
  table{ width:100%; border-collapse:collapse; }
  thead th{ background:#1e293b; color:white; font-weight:700; border:1px solid #334155; padding:6px 8px; font-size:10px; }
  th.text-right, td.text-right{ text-align:right; }
  tbody tr:nth-child(even) td{ background:#f8fafc; }
  tbody td{ border:1px solid #e2e8f0; padding:5px 8px; font-size:10px; vertical-align:top; }
  tfoot td{ border:1px solid #475569; padding:6px 8px; font-size:11px; font-weight:800; background:#1e293b; color:white; }
  .doc-footer{ margin-top:14px; padding-top:8px; border-top:1px solid #e2e8f0;
    display:flex; justify-content:space-between; font-size:9px; color:#9ca3af; }
  tr{ page-break-inside:avoid; }
  thead{ display:table-header-group; }
  tfoot{ display:table-footer-group; }
`;

// ── Vue journal (reprend printJournalView) ────────────────────────────────
export function printJournalView({ j, data, mois, annee, tenantNom }) {
  const s = data.soldes || {};
  const ranAuto = data.ran_auto || 0;
  const mouvements = data.mouvements || [];
  const arret = data.arret || null;
  const isArrete = Boolean(arret);
  const soldeVal = parseFloat(s.solde) || 0;
  const nbE = mouvements.filter((m) => parseFloat(m.entree) > 0).length;
  const nbS = mouvements.filter((m) => parseFloat(m.sortie) > 0).length;

  let cumul = ranAuto;
  const rows = mouvements.length === 0
    ? `<tr><td colspan="7" style="text-align:center;padding:20px;color:#9ca3af;font-style:italic">Aucun mouvement pour cette période</td></tr>`
    : mouvements.map((m) => {
        const e = parseFloat(m.entree) || 0;
        const so = parseFloat(m.sortie) || 0;
        cumul += e - so;
        const cc = cumul >= 0 ? '#15803d' : '#b91c1c';
        return `<tr>
          <td style="color:#6b7280;white-space:nowrap">${new Date(m.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
          <td><span style="background:#f1f5f9;border:1px solid #cbd5e1;padding:1px 5px;border-radius:3px;font-weight:700;font-size:9px;color:#475569;white-space:nowrap">${m.rubrique_code}</span></td>
          <td>${m.intitule}${m.objet ? `<br><span style="font-size:9px;color:#9ca3af">${m.objet}</span>` : ''}</td>
          <td style="color:#6b7280">${m.beneficiaire || '—'}</td>
          <td style="text-align:right;color:#15803d;font-weight:700">${e > 0 ? fmtN(e) : ''}</td>
          <td style="text-align:right;color:#b91c1c;font-weight:700">${so > 0 ? fmtN(so) : ''}</td>
          <td style="text-align:right;font-weight:800;color:${cc}">${fmtN(cumul)}</td>
        </tr>`;
      }).join('');

  const html = `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8">
<title>${j.nom} — ${mois} ${annee}</title>
<style>
  ${A4_LANDSCAPE_BASE_CSS}
  .arret-banner{ background:#f0fdf4; border:1px solid #86efac; border-radius:4px; padding:6px 10px; margin-bottom:10px; font-size:10px; color:#15803d; }
  .kpi-sol{ border-left:3px solid ${soldeVal >= 0 ? '#16a34a' : '#dc2626'}; }
  .kpi-sol .kpi-value{ color:${soldeVal >= 0 ? '#15803d' : '#b91c1c'}; }
  .tfoot-ent{ text-align:right; color:#86efac; }
  .tfoot-sor{ text-align:right; color:#fca5a5; }
  .tfoot-sol{ text-align:right; color:white; font-size:12px; }
</style>
</head><body>

  <div class="doc-header">
    <div class="dh-left">
      <div class="company">${tenantNom || 'CaissePro'}</div>
      <div class="doc-title">Journal de caisse — ${j.nom}&nbsp;&nbsp;<span style="background:#f1f5f9;border-radius:4px;padding:1px 6px;font-size:11px;color:#475569">${j.code}</span></div>
      <div class="doc-sub">${TYPE_LABEL_P[j.type] || j.type} · ${isArrete ? 'Caisse arrêtée' : 'Caisse ouverte'}</div>
    </div>
    <div class="dh-right">
      <div class="period">${mois} ${annee}</div>
      <div style="margin-bottom:4px"><span class="badge ${isArrete ? 'badge-arrete' : 'badge-ouverte'}">${isArrete ? '🔒 Arrêtée' : '🔓 Ouverte'}</span></div>
      <div class="print-date">Imprimé le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
    </div>
  </div>

  ${isArrete ? `<div class="arret-banner">🔒 Arrêtée le ${new Date(arret.arrete_le).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })} par <strong>${arret.arrete_par_nom || '—'}</strong> · Solde arrêté : <strong>${fmtN(arret.solde_final)} FCFA</strong>${arret.commentaire ? ` · « ${arret.commentaire} »` : ''}</div>` : ''}

  <div class="kpi-grid">
    <div class="kpi-box kpi-ran"><div class="kpi-label">Report à Nouveau</div><div class="kpi-value">${fmtN(ranAuto)}</div><div class="kpi-sub">FCFA</div></div>
    <div class="kpi-box kpi-ent"><div class="kpi-label">Entrées du mois</div><div class="kpi-value">${fmtN(s.entrees)}</div><div class="kpi-sub">${nbE} opération${nbE > 1 ? 's' : ''}</div></div>
    <div class="kpi-box kpi-sor"><div class="kpi-label">Sorties du mois</div><div class="kpi-value">${fmtN(s.sorties)}</div><div class="kpi-sub">${nbS} opération${nbS > 1 ? 's' : ''}</div></div>
    <div class="kpi-box kpi-sol"><div class="kpi-label">Solde Final</div><div class="kpi-value">${fmtN(s.solde)}</div><div class="kpi-sub">RAN + Entrées − Sorties</div></div>
  </div>

  <div class="section-title">
    <span>Détail des mouvements — ${mois} ${annee}</span>
    <span class="section-count">${mouvements.length} ligne${mouvements.length > 1 ? 's' : ''}</span>
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
    ${mouvements.length > 0 ? `
    <tfoot>
      <tr>
        <td colspan="4">TOTAL DU MOIS — ${mois} ${annee}</td>
        <td class="tfoot-ent">${fmtN(s.entrees)}</td>
        <td class="tfoot-sor">${fmtN(s.sorties)}</td>
        <td class="tfoot-sol">${fmtN(s.solde)}</td>
      </tr>
    </tfoot>` : ''}
  </table>

  <div class="doc-footer">
    <span>${tenantNom || 'CaissePro'} · Journal ${j.nom} (${j.code}) · ${mois} ${annee}</span>
    <span>CaissePro v2 — Document généré le ${new Date().toLocaleDateString('fr-FR')}</span>
  </div>

  <script>window.onload=()=>{ window.print(); };<\/script>
</body></html>`;

  return openPrintWindowViaWrite(html);
}

// ── Récap des journaux (reprend printJournauxRecap) ───────────────────────
export function printJournauxRecap({ journaux, banque, mois, annee, tenantNom }) {
  const totalE = journaux.reduce((s, j) => s + j.total_entrees, 0);
  const totalS = journaux.reduce((s, j) => s + j.total_sorties, 0);
  const totalSol = journaux.reduce((s, j) => s + j.solde_final, 0);
  const totalRan = journaux.reduce((s, j) => s + j.ran, 0);

  const rows = journaux.map((j) => `
    <tr>
      <td><strong>${j.nom}</strong>&nbsp;<span style="background:#f1f5f9;border-radius:3px;padding:0 4px;font-size:9px;color:#6b7280">${j.code}</span></td>
      <td style="color:#6b7280">${TYPE_LABEL_P[j.type] || j.type}</td>
      <td style="text-align:right;color:#92400e;font-weight:700">${fmtN(j.ran)}</td>
      <td style="text-align:right;color:#15803d;font-weight:700">${fmtN(j.total_entrees)}</td>
      <td style="text-align:right;color:#b91c1c;font-weight:700">${fmtN(j.total_sorties)}</td>
      <td style="text-align:right;font-weight:800;color:${j.solde_final >= 0 ? '#15803d' : '#b91c1c'}">${fmtN(j.solde_final)}</td>
      <td style="text-align:center"><span style="padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;
        background:${j.arrete ? '#dcfce7' : '#fef9c3'};color:${j.arrete ? '#15803d' : '#92400e'}">${j.arrete ? '🔒 Arrêtée' : '🔓 Ouverte'}</span></td>
    </tr>`).join('');

  const banqueRow = (banque.solde_final > 0 || banque.fonds_recus > 0) ? `
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
  ${A4_LANDSCAPE_BASE_CSS}
  .kpi-sol{ border-left:3px solid #0369a1; } .kpi-sol .kpi-value{ color:#0369a1; }
</style>
</head><body>
  <div class="doc-header">
    <div class="dh-left">
      <div class="company">${tenantNom || 'CaissePro'}</div>
      <div class="doc-title">État consolidé — Journaux de caisse</div>
      <div style="font-size:10px;color:#6b7280;margin-top:2px">${journaux.length} journal${journaux.length > 1 ? 'x' : ''} de caisse</div>
    </div>
    <div class="dh-right">
      <div class="period">${mois} ${annee}</div>
      <div class="print-date">Imprimé le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-box kpi-ran"><div class="kpi-label">Total RAN</div><div class="kpi-value">${fmtN(totalRan)} FCFA</div></div>
    <div class="kpi-box kpi-ent"><div class="kpi-label">Total Entrées</div><div class="kpi-value">${fmtN(totalE)} FCFA</div></div>
    <div class="kpi-box kpi-sor"><div class="kpi-label">Total Sorties</div><div class="kpi-value">${fmtN(totalS)} FCFA</div></div>
    <div class="kpi-box kpi-sol"><div class="kpi-label">Solde Global Caisses</div><div class="kpi-value">${fmtN(totalSol)} FCFA</div></div>
  </div>

  <div class="section-title">Récapitulatif par journal — ${mois} ${annee}</div>
  <table>
    <thead>
      <tr>
        <th>Journal</th><th>Type</th>
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
        <td style="text-align:right;color:#93c5fd;font-size:12px">${fmtN(totalSol + (banque.solde_final || 0))}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <div class="doc-footer">
    <span>${tenantNom || 'CaissePro'} · Journaux de caisse · ${mois} ${annee}</span>
    <span>CaissePro v2 — Document généré le ${new Date().toLocaleDateString('fr-FR')}</span>
  </div>
  <script>window.onload=()=>{ window.print(); };<\/script>
</body></html>`;

  return openPrintWindowViaWrite(html);
}

// ── Demande de fonds (reprend imprimerDemande — technique Blob URL) ───────
export function printDemandeFonds(s) {
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const tr = s.tresorerie;
  const lignesPrev = s.prevision.map((r) => `<tr><td><span class="badge">${r.rubrique_code}</span></td><td>${r.intitule}</td><td class="sol" style="text-align:right">${fmtN(r.montant)}</td></tr>`).join('');
  const lignesRes = s.ressources_attente.map((r) => `<tr><td><span class="badge">${r.rubrique_code}</span></td><td>${r.intitule}</td><td class="ev" style="text-align:right">${fmtN(r.montant)}</td></tr>`).join('');
  const lignesDep = s.depenses_attente.map((r) => `<tr><td><span class="badge">${r.rubrique_code}</span></td><td>${r.intitule}</td><td class="sv" style="text-align:right">${fmtN(r.montant)}</td></tr>`).join('');
  const besoinBloc = s.besoin > 0
    ? `<div class="resultat" style="border-color:#e53e3e;background:#fff5f5"><div class="rlabel">FONDS À DEMANDER POUR ${s.mois_cible} ${s.annee_cible}</div><div class="rval" style="color:#c53030">${fmtN(s.besoin)}</div></div>`
    : `<div class="resultat" style="border-color:#38a169;background:#f0fff4"><div class="rlabel">TRÉSORERIE SUFFISANTE POUR ${s.mois_cible} ${s.annee_cible}</div><div class="rval" style="color:#276749">${fmtN(s.excedent)}</div></div>`;
  const css = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;padding:20px;color:#1a202c}.ph{text-align:center;margin-bottom:20px;border-bottom:2px solid #1a365d;padding-bottom:12px}.ph h2{font-size:16px;color:#1a365d;margin-bottom:4px}h3{font-size:13px;color:#1a365d;margin:16px 0 6px}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}th{background:#1a365d;color:#fff;padding:7px 9px;text-align:left}th:last-child{text-align:right}td{padding:6px 9px;border-bottom:1px solid #e2e8f0}.ev{color:#276749;font-weight:600}.sv{color:#c53030;font-weight:600}.sol{color:#1a365d;font-weight:700}.badge{background:#ebf4ff;color:#1a365d;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700}.tot td{background:#edf2f7;font-weight:700}.resultat{border:2px solid;border-radius:8px;padding:14px;text-align:center;margin-top:14px}.rlabel{font-size:11px;font-weight:700;color:#718096;text-transform:uppercase}.rval{font-size:24px;font-weight:700;margin-top:4px}.sig{margin-top:40px;display:flex;justify-content:space-between}.sig div{text-align:center;font-size:11px;width:45%}.sig .line{border-top:1px solid #1a202c;margin-top:40px;padding-top:4px}@media print{@page{size:A4;margin:15mm}}`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Demande de Fonds — ${s.mois_cible} ${s.annee_cible}</title><style>${css}</style></head><body>
    <div class="ph"><h2>DEMANDE DE FONDS</h2><p>Pour la période : <b>${s.mois_cible} ${s.annee_cible}</b></p><p>Imprimé le : ${dateStr}</p></div>
    <h3>1. Trésorerie Actuelle (${s.mois} ${s.annee})</h3>
    <table><tbody>
      ${(tr.journaux && tr.journaux.length)
    ? tr.journaux.map((j) => `<tr><td>Solde ${j.nom} (${j.code})</td><td class="ev" style="text-align:right">${fmtN(j.solde)}</td></tr>`).join('')
      + (tr.banque_saisie_manuelle ? `<tr><td>Solde final en banque</td><td class="ev" style="text-align:right">${fmtN(tr.solde_banque)}</td></tr>` : '')
    : `<tr><td>Solde caisse espèces</td><td class="ev" style="text-align:right">${fmtN(tr.solde_espece)}</td></tr>
      <tr><td>Solde caisse OM</td><td class="ev" style="text-align:right">${fmtN(tr.solde_om)}</td></tr>
      <tr><td>Solde final en banque</td><td class="ev" style="text-align:right">${fmtN(tr.solde_banque)}</td></tr>`}
      <tr class="tot"><td>TOTAL TRÉSORERIE</td><td class="sol" style="text-align:right">${fmtN(tr.total)}</td></tr></tbody></table>
    ${s.ressources_attente.length ? `<h3>2. Ressources Additionnelles Attendues</h3><table><tbody>${lignesRes}<tr class="tot"><td colspan="2">TOTAL RESSOURCES</td><td class="ev" style="text-align:right">${fmtN(s.total_ressources)}</td></tr></tbody></table>` : ''}
    ${s.depenses_attente.length ? `<h3>3. Dépenses en Attente</h3><table><tbody>${lignesDep}<tr class="tot"><td colspan="2">TOTAL EN ATTENTE</td><td class="sol" style="text-align:right">${fmtN(s.total_attente)}</td></tr></tbody></table>` : ''}
    <h3>4. Prévision des Dépenses — ${s.mois_cible} ${s.annee_cible}</h3>
    <table><thead><tr><th>Rubrique</th><th>Intitulé</th><th>Montant prévisionnel</th></tr></thead><tbody>${lignesPrev}<tr class="tot"><td colspan="2">TOTAL PRÉVISIONNEL</td><td class="sol" style="text-align:right">${fmtN(s.total_prevision)}</td></tr></tbody></table>
    ${besoinBloc}
    <div class="sig"><div><div class="line">La Caissière</div></div><div><div class="line">Le Directeur (Approbation)</div></div></div>
    </body></html>`;

  return openPrintWindowViaBlob(html);
}

// ── Compte d'emploi (reconstruit à partir des données, sans clonage DOM) ──
export function printCompteEmploi({ meta, ressources, emplois, tresorerie_finale, solde_net }) {
  const jTypeLabel = (t) => CE_TYPE_LABEL[t] || t;
  const jTypeIco = (t) => CE_TYPE_ICO[t] || '💼';

  const resRow = (ico, label, montant, sub = '') => montant === 0 ? '' : `
    <tr class="ce-res-row">
      <td style="padding:9px 14px;display:flex;align-items:center;gap:8px">
        <span style="font-size:13px;flex-shrink:0">${ico}</span>
        <span><span style="font-weight:500">${label}</span>${sub ? `<span style="font-size:10px;color:#6b7280;display:block;margin-top:1px">${sub}</span>` : ''}</span>
      </td>
      <td style="padding:9px 14px;text-align:right;font-weight:600;color:#059669;font-size:12px">${fmtN(montant)}</td>
    </tr>`;

  const ranLignes = (ressources.journaux || []).filter((j) => j.ran > 0)
    .map((j) => resRow(jTypeIco(j.journal_type), j.journal_nom, j.ran, `Solde initial (RAN) · ${jTypeLabel(j.journal_type)}`)).join('');
  const ranBanqueRow = ressources.solde_banque_initial > 0 ? resRow('🏦', 'Banque', ressources.solde_banque_initial, 'Solde initial (mois précédent)') : '';
  const fondsLignes = (ressources.journaux || []).filter((j) => j.fonds_recus > 0)
    .map((j) => resRow(jTypeIco(j.journal_type), j.journal_nom, j.fonds_recus, `Fonds reçus · ${jTypeLabel(j.journal_type)}`)).join('');
  const fondsBanqueRow = ressources.fonds_recus_banque > 0 ? resRow('🏦', 'Banque', ressources.fonds_recus_banque, 'Fonds reçus en banque') : '';

  const emploisTriees = [...(emplois.lignes || [])].sort((a, b) => b.total - a.total);
  const emploisLignes = emploisTriees.map((e) => `
    <tr class="ce-emp-row">
      <td style="padding:8px 14px;width:44px">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:20px;background:#fff1f2;border:1px solid #fecdd3;border-radius:5px;font-size:10px;font-weight:700;color:#dc2626">${e.rubrique_code}</span>
      </td>
      <td style="padding:8px 4px;font-size:12px">${e.intitule}</td>
      <td style="padding:8px 14px;text-align:right;color:#9a3412;font-size:11px">${e.esp > 0 ? fmtN(e.esp) : '—'}</td>
      <td style="padding:8px 14px;text-align:right;color:#9a3412;font-size:11px">${e.om > 0 ? fmtN(e.om) : '—'}</td>
      <td style="padding:8px 14px;text-align:right;font-weight:700;color:#dc2626;font-size:12px">${fmtN(e.total)}</td>
    </tr>`).join('');

  const tresoLignes = (tresorerie_finale.journaux || []).map((j) => `
    <tr class="ce-res-row">
      <td style="padding:7px 14px 7px 30px;display:flex;align-items:center;gap:6px;font-size:12px">
        <span>${jTypeIco(j.journal_type)}</span>
        <span><span style="font-size:11px;color:#6b7280">dont</span> <strong>${j.journal_nom}</strong> <span style="font-size:10px;color:#6b7280">(${jTypeLabel(j.journal_type)})</span></span>
      </td>
      <td style="padding:7px 14px;text-align:right;font-weight:600;font-size:12px;color:${j.solde_final >= 0 ? '#1d4ed8' : '#dc2626'}">${fmtN(j.solde_final)}</td>
    </tr>`).join('');
  const banqueSF = tresorerie_finale.solde_banque || 0;
  const ecart = tresorerie_finale.ecart !== undefined ? tresorerie_finale.ecart : (solde_net - tresorerie_finale.disponible);
  const ecartOk = Math.abs(ecart) < 1;

  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#1a1a1a;background:white;padding:18mm 16mm}
    .ce-section{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:12px}
    .ce-section-head{display:flex;align-items:center;gap:10px;padding:10px 14px}
    .ce-section-head.green{background:#f0fdf4;border-bottom:1px solid #bbf7d0}
    .ce-section-head.red{background:#fff1f2;border-bottom:1px solid #fecaca}
    .ce-section-head.blue{background:#eff6ff;border-bottom:1px solid #bfdbfe}
    .ce-num{width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;flex-shrink:0}
    .sec-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
    .sec-total{margin-left:auto;font-size:13px;font-weight:800}
    .ce-subtit{padding:5px 14px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc;color:#6b7280;border-bottom:1px solid #f1f5f9}
    table{width:100%;border-collapse:collapse}
    .ce-res-row td,.ce-emp-row td{border-bottom:1px solid #f9fafb}
    tfoot td{font-weight:700;border-top:2px solid #e2e8f0;padding:9px 14px}
    .print-head{text-align:center;padding-bottom:14px;margin-bottom:16px;border-bottom:3px solid #2563eb}
    @media print{@page{size:A4;margin:15mm}}
  `;

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
    <title>Compte d'Emploi — ${meta.mois} ${meta.annee}</title>
    <style>${css}</style></head><body>
      <div class="print-head">
        <h1 style="font-size:16px;font-weight:800;color:#2563eb;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">COMPTE D'EMPLOI</h1>
        <p style="font-size:13px;font-weight:600;color:#374151">${meta.tenant_nom || ''} · ${meta.mois} ${meta.annee}</p>
      </div>

      <div class="ce-section">
        <div class="ce-section-head green">
          <span class="ce-num" style="background:#16a34a;color:white">I</span>
          <span class="sec-title" style="color:#15803d">Ressources</span>
          <span class="sec-total" style="color:#15803d">${fmtN(ressources.total)}</span>
        </div>
        <table>
          <tbody>
            <tr class="ce-subtit"><td colspan="2">Soldes initiaux — Report à Nouveau (RAN)</td></tr>
            ${ranLignes || '<tr class="ce-res-row"><td style="padding:9px 14px;color:#6b7280;font-style:italic" colspan="2">Aucun solde initial enregistré</td></tr>'}
            ${ranBanqueRow}
            <tr class="ce-subtit"><td colspan="2">Fonds reçus ce mois</td></tr>
            ${fondsLignes || '<tr class="ce-res-row"><td style="padding:9px 14px;color:#6b7280;font-style:italic" colspan="2">Aucun fonds reçu ce mois</td></tr>'}
            ${fondsBanqueRow}
          </tbody>
          <tfoot><tr><td>TOTAL RESSOURCES</td><td style="text-align:right;color:#15803d">${fmtN(ressources.total)}</td></tr></tfoot>
        </table>
      </div>

      <div class="ce-section">
        <div class="ce-section-head red">
          <span class="ce-num" style="background:#dc2626;color:white">II</span>
          <span class="sec-title" style="color:#b91c1c">Emplois</span>
          <span class="sec-total" style="color:#b91c1c">${fmtN(emplois.total)}</span>
        </div>
        <table>
          <thead><tr>
            <th style="padding:6px 14px;text-align:left;font-size:9px;color:#9ca3af;text-transform:uppercase">Code</th>
            <th style="padding:6px 4px;text-align:left;font-size:9px;color:#9ca3af;text-transform:uppercase">Rubrique</th>
            <th style="padding:6px 14px;text-align:right;font-size:9px;color:#9ca3af;text-transform:uppercase">Espèces</th>
            <th style="padding:6px 14px;text-align:right;font-size:9px;color:#9ca3af;text-transform:uppercase">MM</th>
            <th style="padding:6px 14px;text-align:right;font-size:9px;color:#9ca3af;text-transform:uppercase">Total</th>
          </tr></thead>
          <tbody>${emploisLignes || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#9ca3af;font-style:italic">Aucune dépense enregistrée ce mois.</td></tr>'}</tbody>
          <tfoot><tr><td colspan="4">TOTAL EMPLOIS</td><td style="text-align:right;color:#b91c1c">${fmtN(emplois.total)}</td></tr></tfoot>
        </table>
      </div>

      <div class="ce-section">
        <div class="ce-section-head blue">
          <span class="ce-num" style="background:#1d4ed8;color:white;font-size:9px">III</span>
          <span class="sec-title" style="color:#1e40af">Trésorerie Finale &amp; Soldes</span>
          <span class="sec-total" style="color:${solde_net >= 0 ? '#1d4ed8' : '#dc2626'}">${fmtN(solde_net)}</span>
        </div>
        <table>
          <tbody>
            <tr><td style="padding:10px 14px;font-weight:700;font-size:12px;color:#1e40af">⚖️ Trésorerie Finale (Ressources − Emplois)</td><td style="padding:10px 14px;text-align:right;font-weight:800;font-size:13px;color:${solde_net >= 0 ? '#1d4ed8' : '#dc2626'}">${fmtN(solde_net)}</td></tr>
            ${tresoLignes}
            <tr class="ce-res-row"><td style="padding:7px 14px 7px 30px;display:flex;align-items:center;gap:6px;font-size:12px"><span>🏦</span><span><span style="font-size:11px;color:#6b7280">dont</span> <strong>Banque</strong> <span style="font-size:10px;color:#6b7280">(Compte bancaire)</span></span></td><td style="padding:7px 14px;text-align:right;font-weight:600;font-size:12px;color:${banqueSF >= 0 ? '#1d4ed8' : '#dc2626'}">${fmtN(banqueSF)}</td></tr>
          </tbody>
          <tfoot><tr><td style="color:${ecartOk ? '#15803d' : '#92400e'}">${ecartOk ? '✅' : '⚠️'} Écart (Trésorerie − Σ Soldes des comptes)</td><td style="text-align:right;color:${ecartOk ? '#15803d' : '#b45309'}">${ecart >= 0 ? '+' : ''}${fmtN(ecart)}</td></tr></tfoot>
        </table>
      </div>

      <div style="margin-top:10px;font-size:9px;color:#9ca3af;text-align:right">Édité le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })} — CaissePro v2</div>
      <script>window.onload=()=>window.print();<\/script>
    </body></html>`;

  return openPrintWindowViaWrite(html);
}
