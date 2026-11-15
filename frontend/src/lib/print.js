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

// ── En-tête « entité » commun à tous les documents ───────────────────────
// Logo, raison sociale, coordonnées et mentions légales du client, tels que
// saisis dans Configuration → Entité (GET /api/config/entete).
const escE = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logoSur = (u) => (typeof u === 'string' && /^(data:image\/(png|jpeg|webp);base64,|https?:\/\/|\/)/.test(u) ? u : '');
// Texte brut (non échappé) : utilisable aussi dans l'interface React.
export function lignesEntite(ent) {
  if (!ent) return { coord: [], legal: [] };
  return {
    coord: [
      ent.adresse,
      ent.boite_postale && (/^\s*bp/i.test(ent.boite_postale) ? ent.boite_postale : `BP ${ent.boite_postale}`),
      ent.telephone && `Tél. ${ent.telephone}`,
      ent.email,
      ent.site_web,
    ].filter(Boolean),
    legal: [
      ent.forme_juridique,
      ent.registre_commerce && `RCCM ${ent.registre_commerce}`,
      ent.nui && `NUI ${ent.nui}`,
    ].filter(Boolean),
  };
}
const coordonneesEntite = (ent) => lignesEntite(ent).coord.map(escE).join(' · ');
const mentionsEntite = (ent) => lignesEntite(ent).legal.map(escE).join(' · ');
const ENTITE_CSS = `
  .ent{ display:flex; align-items:center; gap:10px; min-width:0; }
  .ent img{ max-height:46px; max-width:120px; object-fit:contain; flex-shrink:0; }
  .ent-nom{ font-size:15px; font-weight:800; color:#1e293b; line-height:1.15; }
  .ent-nom small{ font-size:11px; font-weight:600; color:#64748b; }
  .ent-l{ font-size:9px; color:#64748b; margin-top:2px; line-height:1.35; }
  .ent-pied{ text-align:center; font-size:8.5px; color:#64748b; border-top:1px solid #e2e8f0; padding-top:5px; margin-top:12px; line-height:1.5; }
`;
function blocEntite(ent, nomSecours) {
  const nom = ent?.nom || nomSecours || 'CaissePro';
  const logo = logoSur(ent?.logo_url);
  const coord = coordonneesEntite(ent);
  const legal = mentionsEntite(ent);
  return `<div class="ent">${logo ? `<img src="${logo}" alt="">` : ''}<div>
    <div class="ent-nom">${escE(nom)}${ent?.sigle ? ` <small>(${escE(ent.sigle)})</small>` : ''}</div>
    ${coord ? `<div class="ent-l">${coord}</div>` : ''}${legal ? `<div class="ent-l">${legal}</div>` : ''}
  </div></div>`;
}
function piedEntite(ent, nomSecours) {
  const nom = ent?.nom || nomSecours;
  const l = [nom && `<b>${escE(nom)}</b>`, coordonneesEntite(ent), mentionsEntite(ent)].filter(Boolean).join(' · ');
  return l ? `<div class="ent-pied">${l}</div>` : '';
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
  .dh-left .doc-title{ margin-top:8px; }
  ${ENTITE_CSS}
`;

// ── Vue journal (reprend printJournalView) ────────────────────────────────
export function printJournalView({ j, data, mois, annee, tenantNom, entite }) {
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
    ? `<tr><td colspan="8" style="text-align:center;padding:20px;color:#9ca3af;font-style:italic">Aucun mouvement pour cette période</td></tr>`
    : mouvements.map((m) => {
        const e = parseFloat(m.entree) || 0;
        const so = parseFloat(m.sortie) || 0;
        cumul += e - so;
        const cc = cumul >= 0 ? '#15803d' : '#b91c1c';
        const barre = m.annule ? 'text-decoration:line-through;opacity:.6;' : '';
        return `<tr${m.annulation_de_id ? ' style="background:#fef2f2"' : ''}>
          <td style="font-weight:700;color:#475569">${m.numero ?? ''}</td>
          <td style="color:#6b7280;white-space:nowrap;${barre}">${new Date(m.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
          <td><span style="background:#f1f5f9;border:1px solid #cbd5e1;padding:1px 5px;border-radius:3px;font-weight:700;font-size:9px;color:#475569;white-space:nowrap">${m.rubrique_code}</span></td>
          <td><span style="${barre}">${m.intitule}</span>${m.objet ? `<br><span style="font-size:9px;color:#9ca3af">${m.annulation_de_id ? 'Motif : ' : ''}${m.objet}</span>` : ''}${m.annule ? '<br><span style="font-size:9px;color:#b91c1c;font-weight:700">ANNULÉE</span>' : ''}${m.rattrapage ? `<br><span style="font-size:9px;color:#b45309;font-weight:700">RATTRAPAGE${m.created_at ? ` — saisi le ${new Date(m.created_at).toLocaleDateString('fr-FR')}` : ''}</span>` : ''}</td>
          <td style="color:#6b7280">${m.beneficiaire || '—'}</td>
          <td style="text-align:right;color:${e < 0 ? '#b91c1c' : '#15803d'};font-weight:700;${barre}">${e !== 0 ? fmtN(e) : ''}</td>
          <td style="text-align:right;color:#b91c1c;font-weight:700;${barre}">${so !== 0 ? fmtN(so) : ''}</td>
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
      ${blocEntite(entite, tenantNom)}
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
        <th style="width:36px">N°</th>
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
        <td colspan="5">TOTAL DU MOIS — ${mois} ${annee}</td>
        <td class="tfoot-ent">${fmtN(s.entrees)}</td>
        <td class="tfoot-sor">${fmtN(s.sorties)}</td>
        <td class="tfoot-sol">${fmtN(s.solde)}</td>
      </tr>
    </tfoot>` : ''}
  </table>

  <div class="doc-footer">
    <span>Journal ${j.nom} (${j.code}) · ${mois} ${annee}</span>
    <span>Document généré le ${new Date().toLocaleDateString('fr-FR')}</span>
  </div>
  ${piedEntite(entite, tenantNom)}

  <script>window.onload=()=>{ window.print(); };<\/script>
</body></html>`;

  return openPrintWindowViaWrite(html);
}

// ── Récap des journaux (reprend printJournauxRecap) ───────────────────────
export function printJournauxRecap({ journaux, banque, mois, annee, tenantNom, entite }) {
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
      ${blocEntite(entite, tenantNom)}
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
    <span>Journaux de caisse · ${mois} ${annee}</span>
    <span>Document généré le ${new Date().toLocaleDateString('fr-FR')}</span>
  </div>
  ${piedEntite(entite, tenantNom)}
  <script>window.onload=()=>{ window.print(); };<\/script>
</body></html>`;

  return openPrintWindowViaWrite(html);
}

// ── Demande de fonds (reprend imprimerDemande — technique Blob URL) ───────
export function printDemandeFonds(s, entite) {
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const tr = s.tresorerie;
  const lignesPrev = s.prevision.map((r) => `<tr><td><span class="badge">${r.rubrique_code}</span></td><td>${r.intitule}</td><td class="sol" style="text-align:right">${fmtN(r.montant)}</td></tr>`).join('');
  const lignesRes = s.ressources_attente.map((r) => `<tr><td><span class="badge">${r.rubrique_code}</span></td><td>${r.intitule}</td><td class="ev" style="text-align:right">${fmtN(r.montant)}</td></tr>`).join('');
  const lignesDep = s.depenses_attente.map((r) => `<tr><td><span class="badge">${r.rubrique_code}</span></td><td>${r.intitule}</td><td class="sv" style="text-align:right">${fmtN(r.montant)}</td></tr>`).join('');
  const besoinBloc = s.besoin > 0
    ? `<div class="resultat" style="border-color:#e53e3e;background:#fff5f5"><div class="rlabel">FONDS À DEMANDER POUR ${s.mois_cible} ${s.annee_cible}</div><div class="rval" style="color:#c53030">${fmtN(s.besoin)}</div></div>`
    : `<div class="resultat" style="border-color:#38a169;background:#f0fff4"><div class="rlabel">TRÉSORERIE SUFFISANTE POUR ${s.mois_cible} ${s.annee_cible}</div><div class="rval" style="color:#276749">${fmtN(s.excedent)}</div></div>`;
  const css = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;padding:20px;color:#1a202c}.ph{text-align:center;margin-bottom:20px;border-bottom:2px solid #1a365d;padding-bottom:12px}.ph h2{font-size:16px;color:#1a365d;margin-bottom:4px}h3{font-size:13px;color:#1a365d;margin:16px 0 6px}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}th{background:#1a365d;color:#fff;padding:7px 9px;text-align:left}th:last-child{text-align:right}td{padding:6px 9px;border-bottom:1px solid #e2e8f0}.ev{color:#276749;font-weight:600}.sv{color:#c53030;font-weight:600}.sol{color:#1a365d;font-weight:700}.badge{background:#ebf4ff;color:#1a365d;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700}.tot td{background:#edf2f7;font-weight:700}.resultat{border:2px solid;border-radius:8px;padding:14px;text-align:center;margin-top:14px}.rlabel{font-size:11px;font-weight:700;color:#718096;text-transform:uppercase}.rval{font-size:24px;font-weight:700;margin-top:4px}.sig{margin-top:40px;display:flex;justify-content:space-between}.sig div{text-align:center;font-size:11px;width:45%}.sig .line{border-top:1px solid #1a202c;margin-top:40px;padding-top:4px}@media print{@page{size:A4;margin:15mm}}.doc-ent{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}.doc-ent .dr{text-align:right;font-size:10px;color:#64748b;white-space:nowrap}${ENTITE_CSS}`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Demande de Fonds — ${s.mois_cible} ${s.annee_cible}</title><style>${css}</style></head><body>
    <div class="doc-ent">${blocEntite(entite)}</div>
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
    ${piedEntite(entite)}
    </body></html>`;

  return openPrintWindowViaBlob(html);
}

// ── Compte d'emploi (reconstruit à partir des données, sans clonage DOM) ──
// Compte d'emploi en 4 parties : I. Soldes initiaux (RAN) · II. Ressources
// (fonds reçus de la période) · III. Emplois · IV. Trésorerie finale = I + II − III.
// L'API renvoie ressources.total = I + II ; on sépare ici les deux montants.
export function decomposerCompteEmploi({ ressources }) {
  const js = ressources?.journaux || [];
  const soldesInitiaux = js.reduce((s, j) => s + (Number(j.ran) || 0), 0) + (Number(ressources?.solde_banque_initial) || 0);
  const fondsRecus = js.reduce((s, j) => s + (Number(j.fonds_recus) || 0), 0) + (Number(ressources?.fonds_recus_banque) || 0);
  return { soldesInitiaux, fondsRecus };
}

// opts.mode : 'rubrique' (défaut) ou 'compte' — emplois regroupés par compte
// comptable, avec le détail des rubriques sous chaque compte (09/11/2026).
export function printCompteEmploi({ meta, ressources, emplois, tresorerie_finale, solde_net }, entite, opts = {}) {
  const parCompteMode = opts.mode === 'compte';
  const jTypeLabel = (t) => CE_TYPE_LABEL[t] || t;
  const jTypeIco = (t) => CE_TYPE_ICO[t] || '💼';
  const { soldesInitiaux, fondsRecus } = decomposerCompteEmploi({ ressources });

  const resRow = (ico, label, montant, sub = '', couleur = '#059669') => montant === 0 ? '' : `
    <tr class="ce-res-row">
      <td style="padding:9px 14px;display:flex;align-items:center;gap:8px">
        <span style="font-size:13px;flex-shrink:0">${ico}</span>
        <span><span style="font-weight:500">${label}</span>${sub ? `<span style="font-size:10px;color:#6b7280;display:block;margin-top:1px">${sub}</span>` : ''}</span>
      </td>
      <td style="padding:9px 14px;text-align:right;font-weight:600;color:${couleur};font-size:12px">${fmtN(montant)}</td>
    </tr>`;

  const ranLignes = (ressources.journaux || []).filter((j) => j.ran > 0)
    .map((j) => resRow(jTypeIco(j.journal_type), j.journal_nom, j.ran, `Solde initial (RAN) · ${jTypeLabel(j.journal_type)}`, '#0f766e')).join('');
  const ranBanqueRow = ressources.solde_banque_initial > 0 ? resRow('🏦', 'Banque', ressources.solde_banque_initial, 'Solde initial (mois précédent)', '#0f766e') : '';
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

  const parCompte = opts.parCompte || emplois.par_compte || [];
  const emploisParCompte = parCompte.map((g) => `
    <tr class="ce-emp-row" style="background:#fff7f7">
      <td style="padding:8px 14px;width:60px">
        <span style="display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:20px;padding:0 4px;background:#fff1f2;border:1px solid #fecdd3;border-radius:5px;font-size:10px;font-weight:800;color:#b91c1c">${escE(g.compte || '—')}</span>
      </td>
      <td style="padding:8px 4px;font-size:12px;font-weight:700">${escE(g.intitule)}</td>
      <td style="padding:8px 14px;text-align:right;color:#9a3412;font-size:11px">${g.esp ? fmtN(g.esp) : '—'}</td>
      <td style="padding:8px 14px;text-align:right;color:#9a3412;font-size:11px">${g.om ? fmtN(g.om) : '—'}</td>
      <td style="padding:8px 14px;text-align:right;font-weight:800;color:#dc2626;font-size:12px">${fmtN(g.total)}</td>
    </tr>${g.rubriques.map((r) => `
    <tr>
      <td style="padding:4px 14px 4px 26px;font-size:10px;color:#9ca3af">${escE(r.rubrique_code)}</td>
      <td style="padding:4px 4px;font-size:11px;color:#475569">${escE(r.intitule)}</td>
      <td style="padding:4px 14px;text-align:right;color:#9a3412;font-size:10px">${r.esp ? fmtN(r.esp) : '—'}</td>
      <td style="padding:4px 14px;text-align:right;color:#9a3412;font-size:10px">${r.om ? fmtN(r.om) : '—'}</td>
      <td style="padding:4px 14px;text-align:right;color:#b91c1c;font-size:11px">${fmtN(r.total)}</td>
    </tr>`).join('')}`).join('');

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
    .ce-section-head.teal{background:#f0fdfa;border-bottom:1px solid #99f6e4}
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
    .doc-ent{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}
    .doc-ent .dr{text-align:right;font-size:10px;color:#64748b;white-space:nowrap}
    ${ENTITE_CSS}
  `;

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
    <title>Compte d'Emploi — ${meta.mois} ${meta.annee}</title>
    <style>${css}</style></head><body>
      <div class="doc-ent">${blocEntite(entite, meta.tenant_nom)}<div class="dr">Période<br><b style="font-size:13px;color:#1e293b">${meta.mois} ${meta.annee}</b></div></div>
      <div class="print-head">
        <h1 style="font-size:16px;font-weight:800;color:#2563eb;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">COMPTE D'EMPLOI</h1>
        <p style="font-size:13px;font-weight:600;color:#374151">${meta.tenant_nom || ''} · ${meta.mois} ${meta.annee}</p>
      </div>

      <div class="ce-section">
        <div class="ce-section-head teal">
          <span class="ce-num" style="background:#0d9488;color:white">I</span>
          <span class="sec-title" style="color:#0f766e">Soldes initiaux — Report à Nouveau (RAN)</span>
          <span class="sec-total" style="color:#0f766e">${fmtN(soldesInitiaux)}</span>
        </div>
        <table>
          <tbody>
            ${(ranLignes || ranBanqueRow) ? ranLignes + ranBanqueRow : '<tr class="ce-res-row"><td style="padding:9px 14px;color:#6b7280;font-style:italic" colspan="2">Aucun solde initial enregistré</td></tr>'}
          </tbody>
          <tfoot><tr><td>TOTAL SOLDES INITIAUX</td><td style="text-align:right;color:#0f766e">${fmtN(soldesInitiaux)}</td></tr></tfoot>
        </table>
      </div>

      <div class="ce-section">
        <div class="ce-section-head green">
          <span class="ce-num" style="background:#16a34a;color:white;font-size:9px">II</span>
          <span class="sec-title" style="color:#15803d">Ressources — fonds reçus sur la période</span>
          <span class="sec-total" style="color:#15803d">${fmtN(fondsRecus)}</span>
        </div>
        <table>
          <tbody>
            ${(fondsLignes || fondsBanqueRow) ? fondsLignes + fondsBanqueRow : '<tr class="ce-res-row"><td style="padding:9px 14px;color:#6b7280;font-style:italic" colspan="2">Aucun fonds reçu ce mois</td></tr>'}
          </tbody>
          <tfoot><tr><td>TOTAL RESSOURCES</td><td style="text-align:right;color:#15803d">${fmtN(fondsRecus)}</td></tr></tfoot>
        </table>
      </div>

      <div class="ce-section">
        <div class="ce-section-head red">
          <span class="ce-num" style="background:#dc2626;color:white;font-size:8px">III</span>
          <span class="sec-title" style="color:#b91c1c">Emplois${parCompteMode ? ' — par compte comptable' : ''}</span>
          <span class="sec-total" style="color:#b91c1c">${fmtN(emplois.total)}</span>
        </div>
        <table>
          <thead><tr>
            <th style="padding:6px 14px;text-align:left;font-size:9px;color:#9ca3af;text-transform:uppercase">${parCompteMode ? 'Compte' : 'Code'}</th>
            <th style="padding:6px 4px;text-align:left;font-size:9px;color:#9ca3af;text-transform:uppercase">${parCompteMode ? 'Intitulé du compte / rubriques' : 'Rubrique'}</th>
            <th style="padding:6px 14px;text-align:right;font-size:9px;color:#9ca3af;text-transform:uppercase">Espèces</th>
            <th style="padding:6px 14px;text-align:right;font-size:9px;color:#9ca3af;text-transform:uppercase">MM</th>
            <th style="padding:6px 14px;text-align:right;font-size:9px;color:#9ca3af;text-transform:uppercase">Total</th>
          </tr></thead>
          <tbody>${(parCompteMode ? emploisParCompte : emploisLignes) || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#9ca3af;font-style:italic">Aucune dépense enregistrée ce mois.</td></tr>'}</tbody>
          <tfoot><tr><td colspan="4">TOTAL EMPLOIS</td><td style="text-align:right;color:#b91c1c">${fmtN(emplois.total)}</td></tr></tfoot>
        </table>
      </div>

      <div class="ce-section">
        <div class="ce-section-head blue">
          <span class="ce-num" style="background:#1d4ed8;color:white;font-size:9px">IV</span>
          <span class="sec-title" style="color:#1e40af">Trésorerie Finale &amp; Soldes</span>
          <span class="sec-total" style="color:${solde_net >= 0 ? '#1d4ed8' : '#dc2626'}">${fmtN(solde_net)}</span>
        </div>
        <table>
          <tbody>
            <tr class="ce-res-row"><td style="padding:6px 14px;font-size:12px"><b style="color:#0f766e;display:inline-block;width:24px">I.</b>Soldes initiaux</td><td style="padding:6px 14px;text-align:right;font-weight:600;font-size:12px;color:#0f766e">+ ${fmtN(soldesInitiaux)}</td></tr>
            <tr class="ce-res-row"><td style="padding:6px 14px;font-size:12px"><b style="color:#15803d;display:inline-block;width:24px">II.</b>Ressources</td><td style="padding:6px 14px;text-align:right;font-weight:600;font-size:12px;color:#15803d">+ ${fmtN(fondsRecus)}</td></tr>
            <tr class="ce-res-row"><td style="padding:6px 14px;font-size:12px"><b style="color:#b91c1c;display:inline-block;width:24px">III.</b>Emplois</td><td style="padding:6px 14px;text-align:right;font-weight:600;font-size:12px;color:#b91c1c">− ${fmtN(emplois.total)}</td></tr>
            <tr style="background:#eff6ff"><td style="padding:10px 14px;font-weight:700;font-size:12px;color:#1e40af;border-top:2px solid #bfdbfe">⚖️ Trésorerie Finale (I + II − III)</td><td style="padding:10px 14px;text-align:right;font-weight:800;font-size:13px;border-top:2px solid #bfdbfe;color:${solde_net >= 0 ? '#1d4ed8' : '#dc2626'}">${fmtN(solde_net)}</td></tr>
            ${tresoLignes}
            <tr class="ce-res-row"><td style="padding:7px 14px 7px 30px;display:flex;align-items:center;gap:6px;font-size:12px"><span>🏦</span><span><span style="font-size:11px;color:#6b7280">dont</span> <strong>Banque</strong> <span style="font-size:10px;color:#6b7280">(Compte bancaire)</span></span></td><td style="padding:7px 14px;text-align:right;font-weight:600;font-size:12px;color:${banqueSF >= 0 ? '#1d4ed8' : '#dc2626'}">${fmtN(banqueSF)}</td></tr>
          </tbody>
          <tfoot><tr><td style="color:${ecartOk ? '#15803d' : '#92400e'}">${ecartOk ? '✅' : '⚠️'} Écart (Trésorerie − Σ Soldes des comptes)</td><td style="text-align:right;color:${ecartOk ? '#15803d' : '#b45309'}">${ecart >= 0 ? '+' : ''}${fmtN(ecart)}</td></tr></tfoot>
        </table>
      </div>

      <div style="margin-top:10px;font-size:9px;color:#9ca3af;text-align:right">Édité le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
      ${piedEntite(entite, meta.tenant_nom)}
      <script>window.onload=()=>window.print();<\/script>
    </body></html>`;

  return openPrintWindowViaWrite(html);
}

// ════════════════════════════════════════════════════════════════════════
// BON DE CAISSE (A5 portrait) — imprimé à la saisie, réimprimable.
// 1re impression = ORIGINAL ; les suivantes = DUPLICATA n°x (compteur serveur).
// ════════════════════════════════════════════════════════════════════════
const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const DIZAINES = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function moinsDeCent(n) {
  if (n <= 16) return UNITES[n];
  if (n < 20) return `dix-${UNITES[n - 10]}`;
  if (n < 70) {
    const d = Math.floor(n / 10); const u = n % 10;
    if (u === 0) return DIZAINES[d];
    return `${DIZAINES[d]}${u === 1 ? '-et-un' : `-${UNITES[u]}`}`;
  }
  if (n < 80) return n === 71 ? 'soixante-et-onze' : `soixante-${moinsDeCent(n - 60)}`;
  if (n === 80) return 'quatre-vingts';
  return `quatre-vingt-${moinsDeCent(n - 80)}`;
}
function moinsDeMille(n, finale) {
  const c = Math.floor(n / 100); const r = n % 100;
  let txt = '';
  if (c > 0) txt = c === 1 ? 'cent' : `${UNITES[c]}-cent${r === 0 && finale ? 's' : ''}`;
  if (r > 0) txt += (txt ? '-' : '') + moinsDeCent(r);
  if (!finale) txt = txt.replace(/quatre-vingts$/, 'quatre-vingt');
  return txt;
}
// Nombre entier en toutes lettres (orthographe rectifiée 1990 : traits d'union partout).
export function nombreEnLettres(nombre) {
  let n = Math.round(Math.abs(parseFloat(nombre) || 0));
  if (n === 0) return 'zéro';
  const parts = [];
  const echelles = [[1e9, 'milliard'], [1e6, 'million'], [1e3, 'mille']];
  for (const [val, nom] of echelles) {
    const q = Math.floor(n / val);
    if (q > 0) {
      if (nom === 'mille') parts.push(q === 1 ? 'mille' : `${moinsDeMille(q, false)}-mille`);
      else parts.push(`${moinsDeMille(q, true)}-${nom}${q > 1 ? 's' : ''}`);
      n %= val;
    }
  }
  if (n > 0) parts.push(moinsDeMille(n, true));
  return parts.join('-');
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function htmlBonCaisse(m) {
  const e = parseFloat(m.entree) || 0;
  const s = parseFloat(m.sortie) || 0;
  const estAnnulation = Boolean(m.annulation_de_id);
  const estEntree = Math.abs(e) > 0;
  const montant = Math.abs(estEntree ? e : s);
  const devise = m.devise || 'FCFA';
  const num = `${esc(m.journal_code || 'J')}-${String(m.numero ?? 0).padStart(6, '0')}`;
  const duplicata = (m.nb_impressions || 1) > 1;
  const accent = estAnnulation ? '#b91c1c' : estEntree ? '#047857' : '#1d4ed8';
  const accentClair = estAnnulation ? '#fef2f2' : estEntree ? '#ecfdf5' : '#eff6ff';
  const titre = estAnnulation ? "BON D'ANNULATION" : estEntree ? "BON D'ENTRÉE DE CAISSE" : 'BON DE SORTIE DE CAISSE';
  const sousTitre = estAnnulation
    ? `Contre-passation de l'écriture n°${esc(m.numero_origine ?? '')} — ${estEntree ? 'entrée' : 'sortie'} annulée`
    : estEntree ? 'Encaissement' : 'Décaissement';
  const dateTxt = new Date(m.date).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const imprimeLe = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const lettres = nombreEnLettres(montant);
  const enLettres = `${lettres.charAt(0).toUpperCase()}${lettres.slice(1)} ${devise === 'FCFA' ? 'francs CFA' : esc(devise)}`;
  const tiers = estEntree ? 'Versé par' : 'Bénéficiaire';
  const ligne = (lbl, val) => (val ? `<div class="f"><span>${lbl}</span><b>${val}</b></div>` : '');
  const coord = [m.tenant_adresse, m.tenant_bp && (/^\s*bp/i.test(m.tenant_bp) ? m.tenant_bp : `BP ${m.tenant_bp}`),
    m.tenant_tel && `Tél. ${m.tenant_tel}`, m.tenant_email]
    .filter(Boolean).map(esc).join(' · ');
  const legal = [m.tenant_rc && `RCCM ${m.tenant_rc}`, m.tenant_nui && `NUI ${m.tenant_nui}`].filter(Boolean).map(esc).join(' · ');
  const logoBon = logoSur(m.tenant_logo);

  // Deux exemplaires identiques sur une feuille A4 paysage, à signer tous
  // les deux : l'un reste à la caisse (pièce justificative), l'autre est remis
  // au tiers (déposant pour une entrée, bénéficiaire pour une sortie).
  const EXEMPLAIRES = [
    { n: 1, dest: estAnnulation ? 'CAISSE — pièce à classer' : 'CAISSE — pièce justificative à classer' },
    { n: 2, dest: estAnnulation ? 'DIRECTION / CONTRÔLE' : estEntree ? 'DÉPOSANT — à conserver' : 'BÉNÉFICIAIRE — à conserver' },
  ];
  const tiersLbl = estAnnulation ? 'Contrôle' : estEntree ? 'Déposant' : 'Bénéficiaire';
  const tiersNom = estAnnulation ? '' : (m.beneficiaire || '');
  const bon = (ex) => `<div class="bon">
  ${m.annule ? '<div class="wm">ANNULÉ</div>' : duplicata ? '<div class="wm2">DUPLICATA</div>' : ''}
  <div class="ex"><span>EXEMPLAIRE ${ex.n}/2</span><b>${ex.dest}</b></div>
  <div class="head">
    <div class="org">${logoBon ? `<img src="${logoBon}" alt="">` : ''}<div><b>${esc(m.tenant_nom || '')}${m.tenant_sigle ? ` <span class="sig">(${esc(m.tenant_sigle)})</span>` : ''}</b>${coord ? `<small>${coord}</small>` : ''}${legal ? `<small>${legal}</small>` : ''}</div></div>
    <div class="ttl"><h1>${titre}</h1><p>${sousTitre}</p></div>
    <div class="stamp"><small>N° DE PIÈCE</small><div class="no">${num}</div>
      <span class="tag">${duplicata ? `DUPLICATA N°${(m.nb_impressions || 1) - 1}` : 'ORIGINAL'}</span></div>
  </div>
  <div class="body">
    <div class="left">
      <div class="meta">
        <div><span>Date</span><b>${esc(dateTxt)}</b></div>
        <div><span>Caisse</span><b>${esc(m.journal_nom || '')}</b></div>
        <div><span>Période</span><b>${esc(m.mois)} ${esc(m.annee)}</b></div>
        <div><span>Rubrique</span><b>${esc(m.rubrique_code)}${m.rubrique_libelle ? ` — ${esc(m.rubrique_libelle)}` : ''}</b></div>
      </div>
      <div class="fields">
        ${ligne('Libellé', esc(m.intitule))}
        ${ligne(estAnnulation ? "Motif d'annulation" : 'Objet', esc(estAnnulation ? (m.motif_annulation || m.objet) : m.objet))}
        ${ligne(tiers, esc(m.beneficiaire))}
        ${ligne("Pièce d'identité", esc(m.piece_identite))}
        ${ligne('Téléphone', esc(m.telephone))}
        ${m.annule ? ligne('Statut', `<span style="color:#b91c1c">Annulée${m.numero_annulation ? ` (contre-passation n°${esc(m.numero_annulation)})` : ''}${m.motif_annulation ? ` — ${esc(m.motif_annulation)}` : ''}</span>`) : ''}
      </div>
    </div>
    <div class="right"><div class="amount">
      <div class="lbl">${estAnnulation ? 'Montant annulé' : estEntree ? 'Montant reçu' : 'Montant versé'}</div>
      <div class="val">${estAnnulation ? '−' : ''}${fmtN(montant)}<small>${esc(devise)}</small></div>
      <div class="words">Arrêté le présent bon à la somme de :<br><b>${enLettres}</b>.</div>
    </div>
    ${estAnnulation ? '' : `<div class="acquit">${estEntree
      ? `La caisse reconnaît avoir reçu de <b>${esc(m.beneficiaire || '……………………………')}</b> la somme ci-dessus.`
      : `Je soussigné(e) <b>${esc(m.beneficiaire || '……………………………')}</b> reconnais avoir reçu la somme ci-dessus.`}
      <span>« Pour acquit » — Fait à ……………………, le ${esc(new Date(m.date).toLocaleDateString('fr-FR'))}</span></div>`}</div>
  </div>
  <div class="sign">
    <div><b>Caissier(ère)</b><i>${esc(m.caissier_nom || m.saisi_par || '')}</i></div>
    <div><b>${tiersLbl}</b><i>${esc(tiersNom || 'Nom & signature')}</i></div>
    <div><b>Directeur / Visa</b><i>${esc(m.directeur_nom || '')}</i></div>
  </div>
  <div class="foot"><span>Saisi par ${esc(m.saisi_par || '—')} · écriture n°${esc(m.numero)}${String(m.rattrapage) === 'true' ? ` · <b style="color:#b45309">saisie de rattrapage le ${esc(new Date(m.created_at).toLocaleDateString('fr-FR'))}</b>` : ''}</span><span>Imprimé le ${imprimeLe} par ${esc(m.imprime_par || '')}</span></div>
</div>`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Bon ${num}</title>
<style>
@page{size:A4 portrait;margin:6mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;font-size:10px;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#f1f5f9}
@media screen{body{padding:18px}}
.sheet{width:198mm;margin:0 auto;display:flex;flex-direction:column}
.bon{position:relative;height:136mm;background:#fff;border:1px solid #cbd5e1;border-top:5px solid ${accent};border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
@media screen{.bon{box-shadow:0 8px 24px rgba(15,23,42,.12)}}
.cut{height:8mm;position:relative;display:flex;align-items:center;justify-content:center}
.cut:before{content:'';position:absolute;left:0;right:0;top:50%;border-top:1.5px dashed #94a3b8}
.cut span{position:relative;background:#f1f5f9;color:#64748b;font-size:13px;padding:0 6px}
.ex{display:flex;justify-content:space-between;align-items:center;padding:3px 14px;background:#0f172a;color:#fff;font-size:8.5px;letter-spacing:1.2px}
.ex span{opacity:.7;font-weight:700}.ex b{font-size:9px;letter-spacing:1px}
.head{display:grid;grid-template-columns:1fr auto;grid-template-areas:'org stamp' 'ttl ttl';align-items:center;gap:4px 14px;padding:8px 14px 6px;border-bottom:1px dashed #cbd5e1}
.org{grid-area:org}.stamp{grid-area:stamp}.ttl{grid-area:ttl;border-top:1px solid #f1f5f9;padding-top:4px}
.org{display:flex;align-items:center;gap:8px;min-width:0}
.org img{max-height:40px;max-width:90px;object-fit:contain;flex-shrink:0}
.org b{display:block;font-size:14px;font-weight:800;line-height:1.15}.org .sig{color:#64748b;font-weight:600}
.org small{display:block;color:#64748b;font-size:8.5px;margin-top:1px;line-height:1.35}
.ttl{text-align:center}
.ttl h1{font-size:18px;font-weight:900;letter-spacing:1.1px;color:${accent};white-space:nowrap}
.ttl p{color:#64748b;font-size:10px;margin-top:1px}
.stamp{text-align:right;white-space:nowrap}
.stamp small{font-size:8px;color:#94a3b8;letter-spacing:1px}
.stamp .no{font-size:16px;font-weight:900;color:${accent};font-family:Consolas,monospace;letter-spacing:.5px}
.stamp .tag{display:inline-block;margin-top:2px;padding:1px 7px;border-radius:20px;font-size:8.5px;font-weight:800;letter-spacing:1px;
  ${duplicata ? 'background:#fff7ed;color:#c2410c;border:1px solid #fdba74' : `background:${accentClair};color:${accent};border:1px solid ${accent}55`}}
.body{display:grid;grid-template-columns:1.35fr 1fr;gap:14px;padding:12px 14px 6px;flex:1}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:7px 12px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #e2e8f0}
.meta span{display:block;color:#94a3b8;font-size:8.5px;text-transform:uppercase;letter-spacing:.8px}
.meta b{font-size:12.5px}
.f{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid #f1f5f9}
.f span{width:32%;flex-shrink:0;color:#64748b;font-size:11px}
.f b{font-weight:600;font-size:12.5px;word-break:break-word}
.right{display:flex;flex-direction:column;gap:8px}
.acquit{border:1px dashed #cbd5e1;border-radius:10px;padding:8px 12px;font-size:11px;line-height:1.45;color:#334155}
.acquit span{display:block;margin-top:5px;font-size:9.5px;color:#64748b;font-style:italic}
.amount{border-radius:12px;background:${accentClair};border:1.5px solid ${accent}40;padding:14px 14px}
.amount .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:${accent};font-weight:800}
.amount .val{font-size:30px;font-weight:900;color:${accent};font-family:Consolas,monospace;margin-top:2px;white-space:nowrap}
.amount .val small{font-size:12px;font-weight:700;margin-left:3px}
.amount .words{margin-top:8px;padding-top:8px;border-top:1px dashed ${accent}55;font-style:italic;font-size:11px;color:#334155;line-height:1.4}
.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:6px 14px 4px}
.sign div{border:1px solid #e2e8f0;border-radius:7px;height:25mm;padding:4px 8px;font-size:9px;color:#64748b;display:flex;flex-direction:column;justify-content:space-between}
.sign div b{color:#0f172a;font-size:11px}
.sign div i{font-style:normal;font-size:9px;color:#94a3b8;border-top:1px dotted #cbd5e1;padding-top:2px}
.foot{display:flex;justify-content:space-between;padding:3px 14px 5px;color:#94a3b8;font-size:8px}
.wm{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-14deg);font-size:64px;font-weight:900;letter-spacing:8px;color:rgba(185,28,28,.12);border:6px solid rgba(185,28,28,.12);padding:2px 20px;border-radius:12px;pointer-events:none}
.wm2{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-14deg);font-size:56px;font-weight:900;letter-spacing:8px;color:rgba(194,65,12,.08);pointer-events:none}
.bar{width:198mm;margin:0 auto 12px;display:flex;gap:8px;justify-content:flex-end}
.bar button{border:none;border-radius:8px;padding:9px 16px;font-weight:700;cursor:pointer;font-size:12px}
@media print{body{background:#fff}.bon{box-shadow:none}.cut span{background:#fff}.noprint,.bar{display:none!important}}
</style></head><body>
<div class="bar noprint"><button style="background:#e2e8f0" onclick="window.close()">Fermer</button><button style="background:${accent};color:#fff" onclick="window.print()">🖨️ Imprimer</button></div>
<div class="sheet">${bon(EXEMPLAIRES[0])}<div class="cut" aria-hidden="true"><span>✂</span></div>${bon(EXEMPLAIRES[1])}</div>
<script>window.onload=function(){setTimeout(function(){window.print()},350)}</script>
</body></html>`;
}

// Ouvre la fenêtre SYNCHRONEMENT (dans le clic, sinon le bloqueur de popups
// l'empêche après l'appel réseau), puis y écrit le bon une fois les données reçues.
export function ouvrirFenetreBon() {
  const w = window.open('', '_blank', 'width=720,height=900');
  if (w) w.document.write('<p style="font-family:sans-serif;padding:30px;color:#64748b">Préparation du bon de caisse…</p>');
  return w;
}
export function printBonCaisse(m, w) {
  const html = htmlBonCaisse(m);
  if (w && !w.closed) { w.document.open(); w.document.write(html); w.document.close(); return true; }
  return openPrintWindowViaWrite(html);
}

// ── Rapport de contrôle comptable (migrations 042-044) ──────────────────────
// A4 paysage, même lecture que l'écran : synthèse puis détail. « Enregistrer
// en PDF » depuis la boîte d'impression du navigateur.
export function printRapportControle({ data, filtres, entite, tenantNom, devise = 'FCFA' }) {
  const r = data.resume;
  const L = data.lignes;
  const ST = {
    controle: ['Validée', '#166534', '#dcfce7', '#10b981'], anomalie: ['Anomalies constatées', '#991b1b', '#fee2e2', '#ef4444'],
    en_cours: ['En cours', '#92400e', '#fef3c7', '#f59e0b'], a_controler: ['À contrôler', '#475569', '#f1f5f9', '#94a3b8'],
  };
  const ORDRE = ['controle', 'anomalie', 'en_cours', 'a_controler'];
  const mt = (n) => `${fmtN(n)} ${escE(devise)}`;
  const df = (d) => (d ? escE(String(d).slice(0, 10).split('-').reverse().join('/')) : '');
  const pc = (n, t) => (t ? Math.round((n / t) * 100) : 0);
  const montant = (l) => l.debit || l.credit;
  const parSt = Object.fromEntries(ORDRE.map((k) => [k, { n: 0, m: 0 }]));
  const parJ = new Map();
  let total = 0; let risque = 0;
  for (const l of L) {
    const m = montant(l); total += m;
    parSt[l.statut].n += 1; parSt[l.statut].m += m;
    if (l.anomalies.length) risque += m;
    const j = parJ.get(l.journal_code) || { code: l.journal_code || '—', nom: l.journal_nom || '', n: 0, m: 0, f: 0, a: 0 };
    j.n += 1; j.m += m; if (l.statut === 'controle' || l.statut === 'anomalie') j.f += 1; if (l.anomalies.length) j.a += 1;
    parJ.set(l.journal_code, j);
  }
  const faits = r.par_statut.controle + r.par_statut.anomalie;
  const anoms = Object.entries(r.par_anomalie).sort((a, b) => b[1] - a[1]);
  const maxA = anoms.length ? anoms[0][1] : 1;
  const solde = L.reduce((t, l) => t + (l.debit ? -l.debit : l.credit), 0);

  const pile = ORDRE.filter((k) => parSt[k].n).map((k) => `<span style="width:${pc(parSt[k].n, r.total)}%;background:${ST[k][3]}"></span>`).join('');
  const lStatuts = ORDRE.map((k) => `<tr><td><i class="dot" style="background:${ST[k][3]}"></i>${ST[k][0]}</td><td class="n">${parSt[k].n}</td><td class="n mu">${pc(parSt[k].n, r.total)} %</td><td class="n">${mt(parSt[k].m)}</td></tr>`).join('');
  const lAnoms = anoms.length
    ? anoms.map(([k, n]) => `<tr><td>${escE(data.anomalies[k] || k)}</td><td class="bar"><i style="width:${Math.max(6, (n / maxA) * 100)}%"></i></td><td class="n ro">${n}</td></tr>`).join('')
    : '<tr><td colspan="3" style="color:#15803d">✓ Aucune anomalie sur les opérations de la période.</td></tr>';
  const lJournaux = [...parJ.values()].sort((a, b) => b.m - a.m)
    .map((j) => `<tr><td><b>${escE(j.code)}</b> <span class="mu">${escE(j.nom)}</span></td><td class="n">${j.n}</td><td class="n">${mt(j.m)}</td><td class="n">${pc(j.f, j.n)} %</td><td class="n${j.a ? ' ro' : ''}">${j.a}</td></tr>`).join('');

  const lignes = L.map((l) => {
    const s = ST[l.statut];
    const tiers = l.virement ? '<span class="mu">Virement interne</span>'
      : `${l.tiers_nom ? escE(l.tiers_nom) : '<span class="ro">non renseigné</span>'}${l.registre?.verifie ? ' <span class="ve">✓</span>' : ''}<div class="mu mo">${escE(l.tiers_nui || '—')}</div>`;
    const compte = `${l.compte ? `cpte <b>${escE(l.compte)}</b>` : '<span class="ro">compte manquant</span>'}${l.compte_etat === 'non_valide' ? ' <span style="color:#b45309">(non validé)</span>' : ''}${l.compte_etat === 'corrige' ? ` <span style="color:#7c3aed">✎ corrigé (rubrique ${escE(l.compte_rubrique || '—')})</span>` : ''} ↔ ${escE(l.compte_tresorerie || '?')}`;
    const cTiers = l.virement ? '<span class="mu">—</span>'
      : l.compte_tiers ? `<span class="mo">${escE(l.compte_tiers)}</span>${l.compte_tiers_source === 'collectif' ? '<div class="mu">collectif</div>' : ''}` : '<span class="mu">non identifié</span>';
    const dec = l.controle_par && (l.statut === 'controle' || l.statut === 'anomalie') ? `<div class="mu">${escE(l.controle_par)}, ${df(l.controle_le)}</div>` : '';
    const an = l.anomalies.length ? `<div class="an">${l.anomalies_libelles.map((a) => `⚠ ${escE(a)}`).join('<br>')}</div>` : '';
    const ligne = `<tr class="${l.observation ? 'ao' : ''}"><td><b>${escE(l.reference)}</b><div class="mu">${df(l.date)}</div></td><td>${tiers}</td>
      <td>${cTiers}</td><td>${escE(l.libelle)}<div class="mu">${compte}</div></td>
      <td class="n" style="color:${l.debit ? '#b91c1c' : '#15803d'};font-weight:700">${l.debit ? '− ' + mt(l.debit) : '+ ' + mt(l.credit)}</td>
      <td><span class="st" style="background:${s[2]};color:${s[1]}">${s[0]}</span>${dec}${an}</td></tr>`;
    return l.observation ? `${ligne}<tr class="obs"><td colspan="6"><b>Observation :</b> ${escE(l.observation)}</td></tr>` : ligne;
  }).join('');

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport de contrôle — ${df(data.du)} au ${df(data.au)}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm 11mm 12mm; }
    *{ box-sizing:border-box; margin:0; padding:0; }
    body{ font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size:9.5px; color:#1e293b; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    ${ENTITE_CSS}
    .tete{ display:flex; justify-content:space-between; align-items:flex-end; gap:16px; padding-bottom:9px; border-bottom:2.5px solid #1a2b4a; margin-bottom:10px; }
    .titre{ font-size:15px; font-weight:800; color:#1a2b4a; margin-top:7px; }
    .sous{ font-size:9px; color:#64748b; margin-top:2px; }
    .per{ text-align:right; } .per b{ display:block; font-size:13px; color:#1a2b4a; } .per span{ font-size:8.5px; color:#94a3b8; }
    .crit{ font-size:8.5px; color:#475569; background:#f8fafc; border:1px solid #e2e8f0; border-radius:4px; padding:4px 8px; margin-bottom:10px; }
    .kpis{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:10px; }
    .kpi{ border:1px solid #e2e8f0; border-top:3px solid; border-radius:5px; padding:7px 10px; }
    .kpi t{ display:block; font-size:7.5px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; color:#64748b; }
    .kpi v{ display:block; font-size:15px; font-weight:800; margin-top:2px; }
    .kpi s{ display:block; text-decoration:none; font-size:8px; color:#64748b; margin-top:2px; }
    .jg{ height:4px; background:#e2e8f0; border-radius:2px; margin-top:4px; overflow:hidden; } .jg i{ display:block; height:100%; background:#2563eb; }
    .grille{ display:grid; grid-template-columns:1fr 1.3fr 1fr; gap:8px; margin-bottom:12px; }
    .carte{ border:1px solid #e2e8f0; border-radius:5px; padding:7px 9px; }
    h3{ font-size:8.5px; font-weight:800; text-transform:uppercase; letter-spacing:.45px; color:#1a2b4a; margin-bottom:5px; }
    .pile{ display:flex; height:7px; border-radius:4px; overflow:hidden; background:#e2e8f0; margin-bottom:5px; } .pile span{ display:block; height:100%; }
    table{ width:100%; border-collapse:collapse; }
    .mini td,.mini th{ padding:2.5px 4px; border-bottom:1px solid #f1f5f9; font-size:8.5px; text-align:left; }
    .mini th{ font-size:7.5px; text-transform:uppercase; color:#64748b; border-bottom:1px solid #e2e8f0; }
    .mini tr:last-child td{ border-bottom:0; }
    .bar{ width:38%; } .bar i{ display:block; height:6px; border-radius:3px; background:#ef4444; }
    .dot{ display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:4px; }
    .n{ text-align:right !important; white-space:nowrap; } .mu{ color:#64748b; font-size:8px; } .mo{ font-family:Consolas,monospace; }
    .ro{ color:#b91c1c; } .ve{ color:#15803d; }
    .det-t{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px; }
    .det thead th{ background:#1a2b4a; color:#fff; font-size:7.5px; text-transform:uppercase; letter-spacing:.35px; padding:5px 6px; text-align:left; }
    .det td{ padding:5px 6px; border-bottom:1px solid #e2e8f0; vertical-align:top; font-size:8.8px; }
    .det tr.ao td{ border-bottom:0; padding-bottom:2px; }
    .det tr.obs td{ padding:0 6px 5px 6px; font-style:italic; color:#334155; font-size:8.5px; border-bottom:1px solid #e2e8f0; }
    .det tr.obs b{ font-style:normal; font-size:7.5px; text-transform:uppercase; color:#64748b; }
    .det tr{ page-break-inside:avoid; } .det thead{ display:table-header-group; }
    .st{ display:inline-block; padding:1px 6px; border-radius:8px; font-size:7.8px; font-weight:700; }
    .an{ color:#b91c1c; font-size:7.8px; margin-top:2px; line-height:1.35; }
    .tag{ display:inline-block; font-size:7.2px; padding:0 5px; border-radius:6px; background:#f1f5f9; color:#64748b; margin:2px 3px 0 0; }
    .tag.ve{ background:#dcfce7; color:#166534; }
    .tot td{ background:#f1f5f9; font-weight:800; font-size:9px; border-top:1.5px solid #1a2b4a; }
    .visa{ display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:14px; page-break-inside:avoid; }
    .visa div{ border:1px solid #cbd5e1; border-radius:5px; height:62px; padding:5px 8px; font-size:8px; color:#64748b; font-weight:700; text-transform:uppercase; }
    .note{ margin-top:8px; font-size:7.8px; color:#94a3b8; }
  </style></head><body>
  <div class="tete"><div>${blocEntite(entite, tenantNom)}
      <div class="titre">Rapport de contrôle comptable</div>
      <div class="sous">Contrôle préalable à la passerelle comptable — aucune écriture n'a été modifiée</div></div>
    <div class="per"><b>Du ${df(data.du)} au ${df(data.au)}</b><span>Édité le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</span></div></div>
  <div class="crit"><b>Critères :</b> ${escE(filtres)}</div>
  <div class="kpis">
    <div class="kpi" style="border-top-color:#1e293b"><t>Opérations</t><v>${r.total}</v><s>${mt(total)} de mouvements</s></div>
    <div class="kpi" style="border-top-color:#2563eb"><t>Avancement du contrôle</t><v style="color:#2563eb">${pc(faits, r.total)} %</v><div class="jg"><i style="width:${pc(faits, r.total)}%"></i></div><s>${faits} opération(s) décidée(s) sur ${r.total}</s></div>
    <div class="kpi" style="border-top-color:#dc2626"><t>Anomalies constatées</t><v style="color:#dc2626">${r.par_statut.anomalie}</v><s>${mt(parSt.anomalie.m)} concernés</s></div>
    <div class="kpi" style="border-top-color:#b45309"><t>Montant à risque</t><v style="color:#b45309">${mt(risque)}</v><s>${r.avec_anomalies} opération(s) avec au moins un point à vérifier</s></div>
  </div>
  <div class="grille">
    <div class="carte"><h3>Répartition par statut</h3><div class="pile">${pile}</div><table class="mini"><tbody>${lStatuts}</tbody></table></div>
    <div class="carte"><h3>Points à vérifier relevés</h3><table class="mini"><tbody>${lAnoms}</tbody></table></div>
    <div class="carte"><h3>Par journal</h3><table class="mini"><thead><tr><th>Journal</th><th class="n">Opér.</th><th class="n">Montant</th><th class="n">Validé</th><th class="n">⚠</th></tr></thead><tbody>${lJournaux}</tbody></table></div>
  </div>
  <div class="det-t"><h3>Détail des opérations</h3><span class="mu">${L.length} opération(s)</span></div>
  <table class="det"><thead><tr><th style="width:8%">Pièce</th><th style="width:18%">Fournisseur / client</th><th style="width:10%">Compte tiers</th>
    <th style="width:29%">Libellé · code comptable</th><th class="n" style="width:12%">Montant</th><th style="width:23%">Contrôle</th></tr></thead>
    <tbody>${lignes || '<tr><td colspan="6" style="text-align:center">Aucune opération</td></tr>'}
      <tr class="tot"><td colspan="4">Solde des opérations examinées (sorties en négatif, entrées en positif)</td>
      <td class="n" style="color:${solde < 0 ? '#b91c1c' : '#15803d'}">${solde < 0 ? '− ' + mt(-solde) : '+ ' + mt(solde)}</td><td></td></tr></tbody></table>
  <div class="visa"><div>Contrôlé par (nom, date, signature)</div><div>Visa du responsable</div></div>
  <div class="note">Code comptable : compte de la rubrique validé dans la passerelle comptable, ou compte corrigé par le comptable (✎) ; contrepartie : compte de trésorerie du journal. Compte tiers : registre des bénéficiaires payés / encaissés (collectif 401 / 411 à défaut). Les écritures annulées et leurs contre-passations ne sont pas présentées.</div>
  ${piedEntite(entite, tenantNom)}
  <script>window.onload=()=>{ window.print(); };<\/script></body></html>`;
  return openPrintWindowViaWrite(html);
}
