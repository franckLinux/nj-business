import { useEffect, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';

// Étape 4 de la réforme prospects : forfaits, paiements, conversion en client.
export const METHODES = {
  especes: 'Espèces', virement: 'Virement bancaire', orange_money: 'Orange Money', mtn_momo: 'MTN Mobile Money',
  cheque: 'Chèque', carte: 'Carte bancaire', autre: 'Autre',
};
const AVEC_REF = ['virement', 'orange_money', 'mtn_momo', 'cheque', 'carte'];
const STATUTS_PAIEMENT = { en_attente: ['En attente', '#a16207'], recu: ['Reçu', '#15803d'], annule: ['Annulé', '#6b7280'] };
const champ = { padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 13 };
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const montantFr = (m, dev = 'FCFA') => (m === null || m === undefined ? 'Prix à définir' : `${Number(m).toLocaleString('fr-FR')} ${dev}`);
const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
const ajouterMois = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

const Champ = ({ label, children, large }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: large ? '1 1 100%' : '1 1 200px' }}>
    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
    {children}
  </div>
);

export function useForfaits(tous = false) {
  const [forfaits, setForfaits] = useState(null);
  const charger = async () => {
    const r = await api.get(`/forfaits${tous ? '?tous=1' : ''}`);
    setForfaits(Array.isArray(r) ? r : []);
  };
  useEffect(() => { charger(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return [forfaits, charger];
}

// ── Catalogue des forfaits (modification : super_admin) ───────────────────
const FORFAIT_VIDE = { nom: '', description: '', prix: '', devise: 'FCFA', duree_mois: 12, nb_utilisateurs_max: '', nb_caisses_max: '', ordre: 0, actif: true };

export function ForfaitsModal({ onClose, modifiable }) {
  const toast = useToast();
  const [forfaits, charger] = useForfaits(modifiable);
  const [f, setF] = useState(null); // forfait en cours d'édition (id absent = création)
  const [erreur, setErreur] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const enregistrer = async () => {
    const r = f.id ? await api.put(`/forfaits/${f.id}`, f) : await api.post('/forfaits', f);
    if (r.error) { setErreur(r.error); return; }
    toast('Forfait enregistré.', 'success'); setF(null); setErreur(''); charger();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 860 }}>
        <div className="modal-head"><h3>📦 Forfaits</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
          {erreur && <div className="alert-err" style={{ marginBottom: 10 }}>{erreur}</div>}
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
            Modifier un forfait ne change pas les abonnements déjà souscrits : leurs conditions sont figées à la souscription.
          </p>
          {!forfaits ? <div className="loading-msg">Chargement…</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Forfait</th><th>Prix</th><th>Durée</th><th>Limites</th><th>Abonnés</th><th>État</th>{modifiable && <th />}</tr></thead>
              <tbody>
                {forfaits.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>Aucun forfait. {modifiable ? 'Créez le premier ci-dessous.' : 'Le super_admin doit les créer.'}</td></tr>}
                {forfaits.map((x) => (
                  <tr key={x.id}>
                    <td style={{ fontWeight: 700 }}>{x.nom}<div style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>{x.description}</div></td>
                    <td style={{ color: x.prix === null ? '#c2410c' : undefined }}>{montantFr(x.prix, x.devise)}</td>
                    <td>{x.duree_mois} mois</td>
                    <td style={{ fontSize: 12 }}>{x.nb_utilisateurs_max ? `${x.nb_utilisateurs_max} utilisateurs` : 'Utilisateurs illimités'}<br />{x.nb_caisses_max ? `${x.nb_caisses_max} caisses` : 'Caisses illimitées'}</td>
                    <td>{x.nb_abonnes}</td>
                    <td>{x.actif ? 'Actif' : 'Masqué'}</td>
                    {modifiable && <td><button className="btn-secondary" onClick={() => setF({ ...x, prix: x.prix ?? '', nb_utilisateurs_max: x.nb_utilisateurs_max ?? '', nb_caisses_max: x.nb_caisses_max ?? '' })}>Modifier</button></td>}
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          {modifiable && f && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <strong style={{ flex: '1 1 100%' }}>{f.id ? `Modifier « ${f.nom} »` : 'Nouveau forfait'}</strong>
              <Champ label="Nom *"><input style={champ} value={f.nom} onChange={set('nom')} placeholder="Essentiel, Standard, Premium…" /></Champ>
              <Champ label="Prix (vide = à définir)"><input style={champ} value={f.prix} onChange={set('prix')} placeholder="150000" inputMode="decimal" /></Champ>
              <Champ label="Devise"><input style={champ} value={f.devise} onChange={set('devise')} /></Champ>
              <Champ label="Durée (mois)"><input style={champ} type="number" min={1} max={120} value={f.duree_mois} onChange={set('duree_mois')} /></Champ>
              <Champ label="Utilisateurs max (vide = illimité)"><input style={champ} type="number" min={1} value={f.nb_utilisateurs_max} onChange={set('nb_utilisateurs_max')} /></Champ>
              <Champ label="Caisses max (vide = illimité)"><input style={champ} type="number" min={1} value={f.nb_caisses_max} onChange={set('nb_caisses_max')} /></Champ>
              <Champ label="Ordre d'affichage"><input style={champ} type="number" value={f.ordre} onChange={set('ordre')} /></Champ>
              <Champ label="Description" large><textarea rows={2} style={{ ...champ, fontFamily: 'inherit' }} value={f.description} onChange={set('description')} /></Champ>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={f.actif} onChange={set('actif')} style={{ width: 'auto' }} /> Proposé à la vente
              </label>
            </div>
          )}
        </div>
        {modifiable && (
          <div className="modal-foot" style={{ gap: 10 }}>
            {f ? (<>
              <button className="btn-secondary" onClick={() => { setF(null); setErreur(''); }}>Annuler</button>
              <button className="btn-add" onClick={enregistrer}>Enregistrer</button>
            </>) : <button className="btn-add" onClick={() => setF({ ...FORFAIT_VIDE })}>+ Nouveau forfait</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Paiements d'un prospect ───────────────────────────────────────────────
export function PaiementsProspect({ prospect, onChange, setErreur }) {
  const toast = useToast();
  const [forfaits] = useForfaits();
  const [f, setF] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ferme = ['DEMO_ANNULEE', 'PROSPECT_ABANDONNE', 'CLIENT_ACTIF'].includes(prospect.statut);

  const choisirForfait = (e) => {
    const fo = (forfaits || []).find((x) => String(x.id) === e.target.value);
    setF((x) => ({ ...x, forfait_id: e.target.value, montant: fo && fo.prix !== null ? String(Number(fo.prix)) : x.montant, devise: fo ? fo.devise : x.devise }));
  };
  const enregistrer = async () => {
    if (!f.montant) { setErreur('Montant obligatoire.'); return; }
    if (AVEC_REF.includes(f.methode) && !f.reference.trim()) { setErreur('Référence de la transaction obligatoire pour ce mode de paiement.'); return; }
    if (!window.confirm(`Enregistrer un paiement ${f.statut === 'recu' ? 'REÇU' : 'EN ATTENTE'} de ${montantFr(f.montant, f.devise)} (${METHODES[f.methode]}) ?`)) return;
    const r = await api.post(`/prospects/${prospect.id}/paiements`, f);
    if (r.error) { setErreur(r.error); return; }
    toast('Paiement enregistré.', 'success'); setF(null); setErreur(''); onChange();
  };
  const changer = async (pa, statut) => {
    let motif = '';
    if (statut === 'annule') {
      motif = window.prompt(`Annuler le paiement de ${montantFr(pa.montant, pa.devise)} ?\nMotif :`) || '';
      if (!motif.trim()) return;
    } else if (!window.confirm(`Confirmer la réception de ${montantFr(pa.montant, pa.devise)} (réf. ${pa.reference || '—'}) ?`)) return;
    const r = await api.patch(`/paiements/${pa.id}/statut`, { statut, motif });
    if (r.error) { setErreur(r.error); return; }
    toast(statut === 'recu' ? 'Réception confirmée.' : 'Paiement annulé.', 'success'); onChange();
  };

  return (
    <>
      {prospect.paiements.length === 0 ? <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aucun paiement enregistré.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Montant</th><th>Mode</th><th>Référence</th><th>Forfait</th><th>Statut</th><th /></tr></thead>
          <tbody>{prospect.paiements.map((pa) => (
            <tr key={pa.id}>
              <td style={{ fontSize: 12 }}>{dateFr(pa.date_paiement)}</td>
              <td style={{ fontWeight: 700 }}>{montantFr(pa.montant, pa.devise)}</td>
              <td style={{ fontSize: 12 }}>{METHODES[pa.methode]}</td>
              <td style={{ fontSize: 12 }}>{pa.reference || '—'}</td>
              <td style={{ fontSize: 12 }}>{pa.forfait_nom || '—'}</td>
              <td style={{ fontSize: 12, fontWeight: 700, color: STATUTS_PAIEMENT[pa.statut][1] }}>{STATUTS_PAIEMENT[pa.statut][0]}{pa.abonnement_id && <div style={{ fontWeight: 400, color: 'var(--text-muted)' }}>rattaché à l'abonnement</div>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {pa.statut === 'en_attente' && <button className="btn-secondary" onClick={() => changer(pa, 'recu')}>✓ Reçu</button>}{' '}
                {pa.statut !== 'annule' && !pa.abonnement_id && <button className="btn-secondary" onClick={() => changer(pa, 'annule')}>Annuler</button>}
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
      {!ferme && !f && (
        <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => setF({ forfait_id: '', montant: '', devise: 'FCFA', date_paiement: aujourdhui(), methode: 'orange_money', reference: '', statut: 'recu', notes: '' })}>
          💰 Enregistrer un paiement
        </button>
      )}
      {f && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <strong style={{ flex: '1 1 100%' }}>Nouveau paiement</strong>
          <Champ label="Forfait">
            <select style={champ} value={f.forfait_id} onChange={choisirForfait}>
              <option value="">— Choisir —</option>
              {(forfaits || []).map((x) => <option key={x.id} value={x.id}>{x.nom} · {montantFr(x.prix, x.devise)} · {x.duree_mois} mois</option>)}
            </select>
          </Champ>
          <Champ label="Montant *"><input style={champ} value={f.montant} onChange={set('montant')} inputMode="decimal" /></Champ>
          <Champ label="Devise"><input style={champ} value={f.devise} onChange={set('devise')} /></Champ>
          <Champ label="Date du paiement *"><input style={champ} type="date" value={f.date_paiement} onChange={set('date_paiement')} /></Champ>
          <Champ label="Mode de paiement *">
            <select style={champ} value={f.methode} onChange={set('methode')}>
              {Object.entries(METHODES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Champ>
          <Champ label={`Référence de transaction${AVEC_REF.includes(f.methode) ? ' *' : ''}`}><input style={champ} value={f.reference} onChange={set('reference')} placeholder="N° de transaction, de chèque…" /></Champ>
          <Champ label="Statut">
            <select style={champ} value={f.statut} onChange={set('statut')}>
              <option value="recu">Reçu (fonds encaissés)</option>
              <option value="en_attente">En attente de confirmation</option>
            </select>
          </Champ>
          <Champ label="Notes" large><input style={champ} value={f.notes} onChange={set('notes')} /></Champ>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-add" onClick={enregistrer}>Enregistrer</button>
            <button className="btn-secondary" onClick={() => setF(null)}>Annuler</button>
          </div>
        </div>
      )}
      {prospect.abonnements.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <strong style={{ fontSize: 13 }}>Abonnement</strong>
          {prospect.abonnements.map((a) => (
            <p key={a.id} style={{ fontSize: 13, margin: '6px 0' }}>
              {a.client_nom} — <strong>{a.forfait_nom}</strong> ({montantFr(a.prix, a.devise)}) du {dateFr(a.date_debut)} au {dateFr(a.date_fin)} · {a.statut}
              {a.conditions && <span style={{ color: 'var(--text-muted)' }}> · {a.conditions}</span>}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

// ── Conversion en client ──────────────────────────────────────────────────
export function ConversionProspect({ prospect, onClose, onFait, setErreur }) {
  const toast = useToast();
  const [forfaits] = useForfaits();
  const recus = prospect.paiements.filter((p) => p.statut === 'recu' && !p.abonnement_id);
  const [f, setF] = useState(() => ({
    nom: prospect.entreprise || prospect.nom_complet, devise: 'FCFA', paiement_id: recus[0]?.id || '',
    forfait_id: recus[0]?.forfait_id ? String(recus[0].forfait_id) : '', date_debut: aujourdhui(), date_fin: '',
    conditions: '', notes: '', transferer_compte: true,
  }));
  const [enCours, setEnCours] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  // Paiement enregistré après l'ouverture du formulaire, ou changement de
  // paiement : on reprend son forfait.
  const cleRecus = recus.map((p) => p.id).join(',');
  useEffect(() => {
    setF((x) => {
      const pa = recus.find((p) => p.id === x.paiement_id) || recus[0];
      if (!pa) return x;
      return { ...x, paiement_id: pa.id, forfait_id: x.forfait_id || (pa.forfait_id ? String(pa.forfait_id) : '') };
    });
  }, [cleRecus]); // eslint-disable-line react-hooks/exhaustive-deps
  const choisirPaiement = (e) => {
    const pa = recus.find((p) => p.id === e.target.value);
    setF((x) => ({ ...x, paiement_id: e.target.value, forfait_id: pa?.forfait_id ? String(pa.forfait_id) : x.forfait_id }));
  };
  const forfait = (forfaits || []).find((x) => String(x.id) === String(f.forfait_id));
  const finCalculee = forfait && f.date_debut ? ajouterMois(f.date_debut, forfait.duree_mois) : '';
  const compteActive = prospect.invitations.some((i) => i.utilise_le);

  const convertir = async () => {
    if (!f.forfait_id) { setErreur('Choisissez le forfait souscrit.'); return; }
    if (!window.confirm(`Convertir « ${prospect.entreprise || prospect.nom_complet} » en client ?\n\n`
      + `• Un NOUVEL espace client vierge « ${f.nom} » est créé.\n`
      + `• Forfait ${forfait?.nom} du ${dateFr(f.date_debut)} au ${dateFr(f.date_fin || finCalculee)}.\n`
      + `• L'espace de démo est archivé (fermé, données conservées).\n`
      + (f.transferer_compte && compteActive ? '• Le prospect garde son identifiant et son mot de passe.\n' : ''))) return;
    setEnCours(true);
    const r = await api.post(`/prospects/${prospect.id}/conversion`, { ...f, date_fin: f.date_fin || undefined, confirmation: true });
    setEnCours(false);
    if (r.error) { setErreur(r.error); return; }
    toast(`Client créé.${['envoye'].includes(r.statut_email) ? ' E-mail de bienvenue envoyé.' : ' E-mail de bienvenue non envoyé.'}`, 'success');
    onFait(r);
  };

  if (recus.length === 0) {
    return <div className="alert-err" style={{ marginTop: 12 }}>Pour convertir, enregistrez d'abord un paiement <strong>reçu</strong> (onglet Paiements), ou confirmez la réception d'un paiement en attente.</div>;
  }
  return (
    <div style={{ border: '2px solid #15803d', borderRadius: 10, padding: 14, marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <strong style={{ flex: '1 1 100%' }}>✓ Convertir en client payant — nouvel espace vierge</strong>
      <Champ label="Nom du client *"><input style={champ} value={f.nom} onChange={set('nom')} /></Champ>
      <Champ label="Devise de l'espace"><input style={champ} value={f.devise} onChange={set('devise')} /></Champ>
      <Champ label="Paiement rattaché">
        <select style={champ} value={f.paiement_id} onChange={choisirPaiement}>
          {recus.map((p) => <option key={p.id} value={p.id}>{dateFr(p.date_paiement)} · {montantFr(p.montant, p.devise)} · {METHODES[p.methode]} {p.reference}</option>)}
        </select>
      </Champ>
      <Champ label="Forfait *">
        <select style={champ} value={f.forfait_id} onChange={set('forfait_id')}>
          <option value="">— Choisir —</option>
          {(forfaits || []).map((x) => <option key={x.id} value={x.id}>{x.nom} · {montantFr(x.prix, x.devise)} · {x.duree_mois} mois</option>)}
        </select>
      </Champ>
      <Champ label="Début d'abonnement"><input style={champ} type="date" value={f.date_debut} onChange={set('date_debut')} /></Champ>
      <Champ label={`Fin d'abonnement${finCalculee ? ` (auto : ${dateFr(finCalculee)})` : ''}`}><input style={champ} type="date" value={f.date_fin} onChange={set('date_fin')} /></Champ>
      <Champ label="Conditions particulières" large><input style={champ} value={f.conditions} onChange={set('conditions')} placeholder="Remise, échéancier, durée d'engagement…" /></Champ>
      <Champ label="Notes internes" large><input style={champ} value={f.notes} onChange={set('notes')} /></Champ>
      {compteActive && (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, flex: '1 1 100%' }}>
          <input type="checkbox" checked={f.transferer_compte} onChange={set('transferer_compte')} style={{ width: 'auto' }} />
          Le prospect garde son accès ({prospect.email}) dans le nouvel espace
        </label>
      )}
      <p style={{ fontSize: 12, color: 'var(--text-muted)', flex: '1 1 100%', margin: 0 }}>
        {prospect.espace
          ? 'Les données de test ne sont pas reprises. L\'espace de démo est fermé et conservé 90 jours ; rien n\'est supprimé.'
          : 'Ce prospect n\'a pas d\'espace de démo : créez ensuite ses utilisateurs depuis Configuration du nouveau client.'}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-add" onClick={convertir} disabled={enCours}>{enCours ? 'Conversion…' : 'Convertir en client'}</button>
        <button className="btn-secondary" onClick={onClose}>Annuler</button>
      </div>
    </div>
  );
}
