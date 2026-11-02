// NJ COMMERCIAL — lot 5 : factures et avoirs fournisseurs (liste, saisie, fiche avec rapprochement).
// Validée = bon à payer. Les règlements se saisissent dans NJ CAISSE PRO ; aucune écriture comptable ici.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Section, Champ, useListe, fmtMontant, fmtQte } from '@/components/commercial/ui';
import { dateFr } from '@/components/commercial/achats';
import { StatutStock, lireNombre } from '@/components/commercial/stock';
import { useFiche, ActionsCircuit, EtatCircuit, PiecesDoc, HistoriqueDoc, STATUTS_DOC } from '@/components/commercial/fiche';
import { ListeDocsAchat } from '@/pages/commercial/ReceptionsPages';

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const virgule = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
const pct = (n) => `${n > 0 ? '+' : ''}${String(n).replace('.', ',')} %`;

function AFacturer() {
  const navigate = useNavigate();
  const { donnees, erreur } = useListe('/commercial/factures-fournisseurs/a-facturer');
  const liste = donnees || [];
  return (
    <>
      <p className="cm-aide" style={{ margin: '0 0 10px' }}>Fournisseurs dont des réceptions validées ne sont pas encore entièrement facturées.</p>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>Fournisseur</th><th>Réceptions</th><th className="cm-num">Lignes à facturer</th><th /></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={4} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={4} className="cm-vide"><strong>Rien à facturer</strong>Toutes les réceptions validées sont couvertes par des factures.</td></tr>
                : liste.map((f) => (
                  <tr key={f.id}>
                    <td><strong>{f.nom}</strong></td>
                    <td>{f.receptions.join(', ')}</td>
                    <td className="cm-num">{f.lignes}</td>
                    <td style={{ textAlign: 'right' }}><button type="button" className="cm-btn cm-primaire" onClick={() => navigate(`/commercial/factures-fournisseurs/nouvelle?fournisseur=${f.id}`)}>Saisir la facture</button></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function FacturesFournPage() {
  const { can } = useApp();
  const saisit = can('com.factures_fourn.saisir');
  const [vue, setVue] = useState(saisit ? 'a_facturer' : 'facture');
  const ligne = (d) => (
    <>
      <td><span className="cm-code">{d.numero}</span><span className="cm-sous">n° fournisseur {d.reference_fournisseur}</span></td>
      <td>{dateFr(d.date_facture)}{d.date_echeance && <span className="cm-sous">échéance {dateFr(d.date_echeance)}</span>}</td>
      <td><strong>{d.fournisseur_nom}</strong>{d.origine_numero && <span className="cm-sous">sur {d.origine_numero}</span>}</td>
      <td className="cm-num">{fmtMontant(d.total_ttc, d.devise)}</td>
    </>
  );
  return (
    <div className="cm-page">
      <Entete titre="Factures fournisseurs"
        description="Chaque facture se rapproche des réceptions : quantités et prix sont comparés à la commande. Validée, elle devient bon à payer ; le règlement se saisit dans NJ CAISSE PRO." />
      <div className="cm-onglets" role="tablist">
        {saisit && <button type="button" role="tab" aria-selected={vue === 'a_facturer'} onClick={() => setVue('a_facturer')}>À facturer</button>}
        <button type="button" role="tab" aria-selected={vue === 'facture'} onClick={() => setVue('facture')}>Factures</button>
        <button type="button" role="tab" aria-selected={vue === 'avoir'} onClick={() => setVue('avoir')}>Avoirs</button>
      </div>
      {vue === 'a_facturer' && saisit ? <AFacturer /> : (
        <ListeDocsAchat key={vue} url={`/commercial/factures-fournisseurs?type=${vue}`} lien={(d) => `/commercial/factures-fournisseurs/${d.id}`}
          colonnes={[vue === 'avoir' ? 'Avoir' : 'Facture', 'Date', 'Fournisseur', 'Montant TTC']}
          vide={vue === 'avoir' ? 'Un avoir se saisit depuis une facture validée.' : 'Les factures se saisissent depuis l\'onglet « À facturer ».'} ligne={ligne} />
      )}
    </div>
  );
}

export function FactureFournFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [type, setType] = useState(params.get('avoir') ? 'avoir' : 'facture');
  const [ctxDoc, setCtxDoc] = useState(null);   // { fournisseur_id, fournisseur_nom, origine? }
  const [f, setF] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [numero, setNumero] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    (async () => {
      let existant = null; let fournisseur = params.get('fournisseur'); let origineId = params.get('avoir');
      if (id) {
        existant = await api.get(`/commercial/factures-fournisseurs/${id}`);
        if (existant?.error) { setErreur(existant.error); return; }
        if (!existant.droits.modifier) { navigate(`/commercial/factures-fournisseurs/${id}`, { replace: true }); return; }
        setType(existant.type); setNumero(existant.numero);
        fournisseur = existant.fournisseur_id; origineId = existant.facture_origine_id;
      }
      const deja = new Map((existant?.lignes || []).map((l) => [l.reception_ligne_id || l.facture_ligne_origine_id, l]));
      if ((existant?.type || type) === 'avoir') {
        const o = await api.get(`/commercial/factures-fournisseurs/${origineId}`);
        if (o?.error) { setErreur(o.error); return; }
        const rts = await api.get(`/commercial/retours-fournisseurs?fournisseur_id=${o.fournisseur_id}&statut=valide`);
        setCtxDoc({ fournisseur_nom: o.fournisseur_nom, origine: o, retours: Array.isArray(rts) ? rts : [], retour_id: String(existant?.retour_id || params.get('retour') || '') });
        setLignes(o.lignes.map((l) => ({ cle: l.id, designation: l.designation, reference: l.reference, unite: l.unite, max: l.quantite, prix_max: l.prix_unitaire,
          remise_pct: l.remise_pct, taxe_code: l.taxe_code, taxe_taux: l.taxe_taux,
          saisie: virgule(deja.get(l.id)?.quantite ?? ''), prix: virgule(deja.get(l.id)?.prix_unitaire ?? l.prix_unitaire) })));
      } else {
        const dispo = await api.get(`/commercial/factures-fournisseurs/a-facturer/${fournisseur}`);
        if (dispo?.error) { setErreur(dispo.error); return; }
        const toutes = [...dispo];
        (existant?.lignes || []).forEach((l) => { if (!toutes.some((x) => x.id === l.reception_ligne_id)) toutes.push({ id: l.reception_ligne_id, designation: l.designation, reference: l.reference, unite: l.unite, reste: l.quantite, prix_unitaire: l.prix_unitaire, remise_pct: l.remise_pct, taxe_code: l.taxe_code, taxe_taux: l.taxe_taux, reception_numero: '', bc_numero: '' }); });
        const fs = await api.get('/commercial/factures-fournisseurs/a-facturer');
        const nom = (Array.isArray(fs) ? fs : []).find((x) => String(x.id) === String(fournisseur))?.nom || existant?.fournisseur_nom || '';
        setCtxDoc({ fournisseur_id: fournisseur, fournisseur_nom: nom });
        setLignes(toutes.map((l) => {
          const e = deja.get(l.id);
          return { cle: l.id, designation: l.designation, reference: l.reference, unite: l.unite, reste: l.reste, prix_cmd: l.prix_net, remise_pct: virgule(e?.remise_pct ?? l.remise_pct),
            taxe_code: l.taxe_code, taxe_taux: l.taxe_taux, reception_numero: l.reception_numero, bc_numero: l.bc_numero, bl_numero: l.bl_numero,
            saisie: existant ? virgule(e?.quantite ?? '') : virgule(l.reste), prix: virgule(e?.prix_unitaire ?? l.prix_unitaire) };
        }));
      }
      setF(existant
        ? { reference_fournisseur: existant.reference_fournisseur, date_facture: String(existant.date_facture).slice(0, 10),
          date_echeance: existant.date_echeance ? String(existant.date_echeance).slice(0, 10) : '', observations: existant.observations, motif_ecart: existant.motif_ecart }
        : { reference_fournisseur: '', date_facture: aujourdhui(), date_echeance: '', observations: '', motif_ecart: '' });
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setLigne = (i, k, v) => setLignes((ls) => ls.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const calc = lignes.map((l) => {
    const q = lireNombre(l.saisie) || 0; const pu = lireNombre(l.prix) || 0; const rem = lireNombre(l.remise_pct) || 0;
    const ht = Math.round(q * pu * (1 - rem / 100) * 100) / 100;
    return { ht, tx: Math.round(ht * l.taxe_taux) / 100 };
  });
  const tht = calc.reduce((s, x) => s + x.ht, 0); const ttx = calc.reduce((s, x) => s + x.tx, 0);
  const corps = () => (type === 'avoir'
    ? { type, facture_origine_id: ctxDoc.origine.id, retour_id: ctxDoc.retour_id || null, ...f,
      lignes: lignes.map((l) => ({ facture_ligne_origine_id: l.cle, quantite: l.saisie, prix_unitaire: l.prix })) }
    : { type, fournisseur_id: ctxDoc.fournisseur_id, ...f,
      lignes: lignes.map((l) => ({ reception_ligne_id: l.cle, quantite: l.saisie, prix_unitaire: l.prix, remise_pct: l.remise_pct })) });
  const enregistrer = async (soumettre) => {
    setEnCours(true); setErreur('');
    const r = id ? await api.put(`/commercial/factures-fournisseurs/${id}`, corps()) : await api.post('/commercial/factures-fournisseurs', corps());
    if (r?.error) { setEnCours(false); setErreur(r.error); return; }
    if (soumettre) {
      const s = await api.post(`/commercial/factures-fournisseurs/${r.id}/soumission`, { motif_ecart: f.motif_ecart });
      setEnCours(false);
      if (s?.error) { setErreur(s.error); if (!id) navigate(`/commercial/factures-fournisseurs/${r.id}/modifier`, { replace: true }); return; }
      toast(`${s.numero} soumis pour validation.`, 'success');
    } else { setEnCours(false); toast(`Brouillon ${r.numero} enregistré.`, 'success'); }
    navigate(`/commercial/factures-fournisseurs/${r.id}`);
  };

  if (!ctxDoc || !f) return <div className="cm-page">{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const avoir = type === 'avoir';
  return (
    <div className="cm-page">
      <Link to={id ? `/commercial/factures-fournisseurs/${id}` : avoir ? `/commercial/factures-fournisseurs/${ctxDoc.origine.id}` : '/commercial/factures-fournisseurs'} className="cm-retour">
        ‹ {id ? numero : avoir ? ctxDoc.origine.numero : 'Factures fournisseurs'}
      </Link>
      <div className="cm-fiche-tete">
        <div>
          <h2>{id ? `Modifier ${numero}` : avoir ? 'Nouvel avoir fournisseur' : 'Nouvelle facture fournisseur'}</h2>
          <span className="cm-sous">{ctxDoc.fournisseur_nom}{avoir ? ` · sur la facture ${ctxDoc.origine.numero} (n° ${ctxDoc.origine.reference_fournisseur})` : ''}</span>
        </div>
        <div className="cm-actions">
          <button type="button" className="cm-btn cm-secondaire" onClick={() => enregistrer(false)} disabled={enCours}>Enregistrer le brouillon</button>
          <button type="button" className="cm-btn cm-primaire" onClick={() => enregistrer(true)} disabled={enCours}>{enCours ? 'Envoi…' : 'Soumettre pour validation'}</button>
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre={avoir ? 'Avoir' : 'Facture'}>
        <div className="cm-grille">
          <Champ label={`N° ${avoir ? 'de l\'avoir' : 'de la facture'} chez le fournisseur`} requis id="fr"><input id="fr" value={f.reference_fournisseur} onChange={set('reference_fournisseur')} maxLength={60} /></Champ>
          <Champ label="Date" requis id="fd"><input id="fd" type="date" max={aujourdhui()} value={f.date_facture} onChange={set('date_facture')} /></Champ>
          {!avoir && <Champ label="Échéance" id="fe"><input id="fe" type="date" value={f.date_echeance} onChange={set('date_echeance')} /></Champ>}
          {avoir && ctxDoc.origine && (
            <Champ label="Retour lié (facultatif)" id="frt">
              <select id="frt" value={ctxDoc.retour_id} onChange={(e) => setCtxDoc((c) => ({ ...c, retour_id: e.target.value }))}>
                <option value="">— Aucun (avoir commercial) —</option>
                {ctxDoc.retours.map((r) => <option key={r.id} value={r.id}>{r.numero} — {r.motif}</option>)}
              </select>
            </Champ>
          )}
          <Champ label="Observations" id="fo" pleine><textarea id="fo" value={f.observations} onChange={set('observations')} maxLength={2000} /></Champ>
        </div>
      </Section>
      <Section titre="Lignes">
        <table className="cm-lignes">
          <thead>
            <tr>
              <th>Article</th>
              <th style={{ textAlign: 'right' }}>{avoir ? 'Facturé' : 'Reçu à facturer'}</th>
              <th style={{ textAlign: 'right' }}>Quantité</th>
              <th style={{ textAlign: 'right' }}>P.U. HT</th>
              {!avoir && <th style={{ textAlign: 'right' }}>Rem. %</th>}
              <th>Taxe</th>
              <th style={{ textAlign: 'right' }}>Montant HT</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => {
              const pu = lireNombre(l.prix) || 0;
              const net = pu * (1 - (lireNombre(l.remise_pct) || 0) / 100);
              const ecart = !avoir && l.prix_cmd ? Math.round(((net - l.prix_cmd) / l.prix_cmd) * 10000) / 100 : 0;
              return (
                <tr key={l.cle}>
                  <td className="cm-l-article"><strong>{l.designation}</strong>
                    <span className="cm-sous">{l.reference}{l.reception_numero ? ` · ${l.reception_numero}` : ''}{l.bl_numero ? ` (BL ${l.bl_numero})` : ''}{l.bc_numero ? ` · ${l.bc_numero}` : ''}</span></td>
                  <td className="cm-num"><span className="cm-l-lib">Disponible</span>{fmtQte(avoir ? l.max : l.reste)} {l.unite}</td>
                  <td style={{ textAlign: 'right' }}>
                    <input className="cm-qte-input" inputMode="decimal" value={l.saisie} onChange={(e) => setLigne(i, 'saisie', e.target.value)} aria-label={`Quantité de ${l.designation}`} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <input className="cm-qte-input" style={{ width: 100 }} inputMode="decimal" value={l.prix} onChange={(e) => setLigne(i, 'prix', e.target.value)} aria-label={`Prix unitaire de ${l.designation}`} />
                    {!avoir && Math.abs(ecart) > 0.004 && <span className="cm-sous" style={{ color: '#b45309' }}>{pct(ecart)} / commande</span>}
                  </td>
                  {!avoir && <td style={{ textAlign: 'right' }}><input className="cm-qte-input" style={{ width: 60 }} inputMode="decimal" value={l.remise_pct} onChange={(e) => setLigne(i, 'remise_pct', e.target.value)} aria-label={`Remise sur ${l.designation}`} /></td>}
                  <td>{l.taxe_code ? `${l.taxe_code} ${String(l.taxe_taux).replace('.', ',')} %` : '—'}</td>
                  <td className="cm-num"><span className="cm-l-lib">HT</span>{fmtMontant(calc[i].ht, '')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="cm-totaux">
          <div><span>Total HT</span><strong>{fmtMontant(Math.round(tht * 100) / 100)}</strong></div>
          <div><span>Taxes</span><strong>{fmtMontant(Math.round(ttx * 100) / 100)}</strong></div>
          <div className="cm-ttc"><span>Total TTC</span><strong>{fmtMontant(Math.round((tht + ttx) * 100) / 100)}</strong></div>
        </div>
        <p className="cm-aide" style={{ marginTop: 8 }}>Mettez 0 sur une ligne pour ne pas la {avoir ? 'créditer' : 'facturer'}. Montants recalculés par le serveur.</p>
      </Section>
      {!avoir && (
        <Section titre="Écarts avec la commande ou la réception">
          <p className="cm-aide" style={{ marginTop: 0 }}>Si la facture s'écarte de la commande (prix au-delà de la tolérance) ou de ce qui a été reçu (quantité), expliquez pourquoi : la soumission l'exige.</p>
          <Champ label="Motif des écarts" id="fme"><textarea id="fme" value={f.motif_ecart} onChange={set('motif_ecart')} maxLength={500} /></Champ>
        </Section>
      )}
    </div>
  );
}

export function FactureFournPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { d, setD, erreur, enCours, agir } = useFiche(`/commercial/factures-fournisseurs/${id}`);
  if (!d) return <div className="cm-page"><Link to="/commercial/factures-fournisseurs" className="cm-retour">‹ Factures fournisseurs</Link>{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  const avoir = d.type === 'avoir';
  const ecarts = d.rapprochement.filter((x) => x.alerte_quantite || x.alerte_prix);
  return (
    <div className="cm-page">
      <Link to="/commercial/factures-fournisseurs" className="cm-retour">‹ Factures fournisseurs</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2><span className="cm-code" style={{ fontSize: 15 }}>{d.numero}</span>{avoir ? 'Avoir fournisseur' : 'Facture fournisseur'} <StatutStock statut={d.statut} /></h2>
          <span className="cm-sous">{d.fournisseur_nom} · n° {d.reference_fournisseur} · saisie par {d.cree_par_nom}{d.valide_le ? ` · validée par ${d.valide_par_nom} le ${dateFr(d.valide_le, true)}` : ''}</span>
        </div>
        <ActionsCircuit d={d} base="/commercial/factures-fournisseurs" agir={agir} enCours={enCours}
          onSupprime={() => navigate('/commercial/factures-fournisseurs')} onModifier={() => navigate(`/commercial/factures-fournisseurs/${d.id}/modifier`)}
          extra={d.droits.avoir && <button type="button" className="cm-btn cm-secondaire" onClick={() => navigate(`/commercial/factures-fournisseurs/nouvelle?avoir=${d.id}`)}>Saisir un avoir</button>} />
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <EtatCircuit d={d} attente={avoir ? 'En attente de validation.' : 'En attente de validation (bon à payer).'} />
      {d.statut === 'valide' && !avoir && <div className="cm-note">{d.reglement}</div>}
      <div className="cm-deux">
        <div>
          <Section titre={avoir ? 'Avoir' : 'Facture'}>
            <dl className="cm-infos">
              <div><dt>Fournisseur</dt><dd>{d.fournisseur_nom}</dd></div>
              <div><dt>N° chez le fournisseur</dt><dd>{d.reference_fournisseur}</dd></div>
              <div><dt>Date</dt><dd>{dateFr(d.date_facture)}</dd></div>
              {!avoir && <div><dt>Échéance</dt><dd>{d.date_echeance ? dateFr(d.date_echeance) : '—'}</dd></div>}
              {avoir && <div><dt>Facture d'origine</dt><dd><Link to={`/commercial/factures-fournisseurs/${d.facture_origine_id}`}>{d.origine_numero}</Link><span className="cm-sous">n° {d.origine_reference}</span></dd></div>}
              {avoir && d.retour_id && <div><dt>Retour</dt><dd><Link to={`/commercial/retours-fournisseurs/${d.retour_id}`}>{d.retour_numero}</Link></dd></div>}
            </dl>
            {d.motif_ecart && <p className="cm-aide" style={{ marginTop: 10 }}><strong>Motif des écarts :</strong> {d.motif_ecart}</p>}
            {d.observations && <p className="cm-aide" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}><strong>Observations :</strong> {d.observations}</p>}
          </Section>
          <Section titre={`Lignes (${d.lignes.length})`}>
            <table className="cm-lignes cm-bc-lecture">
              <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Quantité</th><th style={{ textAlign: 'right' }}>P.U. HT</th><th style={{ textAlign: 'right' }}>Rem.</th><th>Taxe</th><th style={{ textAlign: 'right' }}>Montant HT</th></tr></thead>
              <tbody>
                {d.lignes.map((l) => (
                  <tr key={l.id}>
                    <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}</span></td>
                    <td className="cm-num"><span className="cm-l-lib">Qté</span>{fmtQte(l.quantite)} {l.unite}</td>
                    <td className="cm-num"><span className="cm-l-lib">P.U.</span>{fmtMontant(l.prix_unitaire, '')}</td>
                    <td className="cm-num"><span className="cm-l-lib">Rem.</span>{l.remise_pct ? `${String(l.remise_pct).replace('.', ',')} %` : '—'}</td>
                    <td><span className="cm-l-lib">Taxe</span>{l.taxe_code ? `${l.taxe_code} ${String(l.taxe_taux).replace('.', ',')} %` : '—'}</td>
                    <td className="cm-num"><span className="cm-l-lib">HT</span><strong>{fmtMontant(l.montant_ht, '')}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="cm-totaux">
              <div><span>Total HT</span><strong>{fmtMontant(d.total_ht, d.devise)}</strong></div>
              <div><span>Taxes</span><strong>{fmtMontant(d.total_taxes, d.devise)}</strong></div>
              <div className="cm-ttc"><span>Total TTC</span><strong>{fmtMontant(d.total_ttc, d.devise)}</strong></div>
              {!avoir && d.avoirs.some((a) => a.statut === 'valide') && <div><span>Net à payer (avoirs déduits)</span><strong>{fmtMontant(d.net_a_payer, d.devise)}</strong></div>}
            </div>
          </Section>
          {!avoir && (
            <Section titre="Rapprochement commande · réception · facture">
              {ecarts.length > 0
                ? <div className="cm-note" style={{ background: '#fffbeb', color: '#92400e' }}>{ecarts.length} ligne(s) en écart (tolérance prix : {String(d.tolerance).replace('.', ',')} %).</div>
                : <p className="cm-aide" style={{ marginTop: 0 }}>Aucun écart : quantités reçues et prix commandés respectés (tolérance {String(d.tolerance).replace('.', ',')} %).</p>}
              <table className="cm-lignes cm-bc-lecture">
                <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Reçu net</th><th style={{ textAlign: 'right' }}>Facturé</th><th style={{ textAlign: 'right' }}>Prix commandé</th><th style={{ textAlign: 'right' }}>Prix facturé</th><th>Contrôle</th></tr></thead>
                <tbody>
                  {d.rapprochement.map((x) => (
                    <tr key={x.ligne_id}>
                      <td className="cm-l-article"><strong>{x.designation}</strong><span className="cm-sous">{x.bc_numero} · {x.reception_numero}</span></td>
                      <td className="cm-num"><span className="cm-l-lib">Reçu net</span>{fmtQte(x.recu_net)} {x.unite}</td>
                      <td className="cm-num"><span className="cm-l-lib">Facturé</span>{fmtQte(x.facture)}{x.deja_facture > 0 && <span className="cm-sous">+ {fmtQte(x.deja_facture)} ailleurs</span>}</td>
                      <td className="cm-num"><span className="cm-l-lib">Commandé</span>{fmtMontant(Math.round(x.prix_commande * 100) / 100, '')}</td>
                      <td className="cm-num"><span className="cm-l-lib">Facturé</span>{fmtMontant(Math.round(x.prix_facture * 100) / 100, '')}</td>
                      <td>
                        {x.alerte_quantite && <span className="cm-pastille cm-rouge">+{fmtQte(x.ecart_quantite)} non reçu</span>}
                        {x.alerte_prix && <span className="cm-pastille cm-alerte">Prix {pct(x.ecart_prix_pct)}</span>}
                        {!x.alerte_quantite && !x.alerte_prix && <span className="cm-pastille cm-ok">Conforme</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.statut === 'valide' && <p className="cm-aide" style={{ marginTop: 8 }}>Rapprochement figé à la validation.</p>}
            </Section>
          )}
          {!avoir && d.avoirs.length > 0 && (
            <Section titre="Avoirs">
              <ul className="cm-pieces">{d.avoirs.map((a) => <li key={a.id}><Link to={`/commercial/factures-fournisseurs/${a.id}`}>{a.numero}</Link><span className="cm-sous">n° {a.reference_fournisseur} · {fmtMontant(a.total_ttc)} · {STATUTS_DOC[a.statut]}</span></li>)}</ul>
            </Section>
          )}
        </div>
        <div>
          <PiecesDoc d={d} base="/commercial/factures-fournisseurs" onMaj={setD} aide="Joignez la facture du fournisseur (PDF ou scan)." />
          <HistoriqueDoc historique={d.historique} />
        </div>
      </div>
    </div>
  );
}

// Contrôles → file de validation des documents d'achat.
export function ValidationAchatsPage() {
  const { can } = useApp();
  const navigate = useNavigate();
  const blocs = [
    ['com.receptions.valider', '/commercial/receptions?statut=a_valider', 'Réceptions', '/commercial/receptions/'],
    ['com.retours_fourn.valider', '/commercial/retours-fournisseurs?statut=a_valider', 'Retours fournisseurs', '/commercial/retours-fournisseurs/'],
    ['com.factures_fourn.valider', '/commercial/factures-fournisseurs?statut=a_valider', 'Factures et avoirs', '/commercial/factures-fournisseurs/'],
  ].filter(([c]) => can(c));
  return (
    <div className="cm-page">
      <Entete titre="Validation des achats" description="Réceptions, retours et factures soumis qui attendent une validation. Personne ne valide un document qu'il a saisi." />
      {blocs.map(([c, url, titre, lien]) => <BlocValidation key={c} url={url} titre={titre} onOuvrir={(d) => navigate(`${lien}${d.id}`)} />)}
    </div>
  );
}
function BlocValidation({ url, titre, onOuvrir }) {
  const { user } = useApp();
  const { donnees } = useListe(url);
  const liste = donnees || [];
  return (
    <Section titre={`${titre} (${liste.length})`}>
      {!donnees ? <p className="cm-aide">Chargement…</p> : liste.length === 0 ? <p className="cm-aide">Rien à valider.</p> : (
        <table className="cm-lignes">
          <tbody>
            {liste.map((d) => (
              <tr key={d.id} className="cm-cliquable" onClick={() => onOuvrir(d)}>
                <td><span className="cm-code">{d.numero}</span></td>
                <td>{d.fournisseur_nom}</td>
                <td>{d.bc_numero || d.reception_numero || (d.reference_fournisseur ? `n° ${d.reference_fournisseur}` : '')}</td>
                <td className="cm-num">{d.total_ttc !== undefined ? fmtMontant(d.total_ttc, d.devise) : ''}</td>
                <td>{d.cree_par_nom}{d.cree_par_nom === user?.username && <span className="cm-sous">vous : un autre valide</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
