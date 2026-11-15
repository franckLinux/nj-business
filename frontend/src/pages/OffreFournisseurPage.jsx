// NJ COMMERCIAL — lot 8 (063) : portail PUBLIC de réponse d'un fournisseur à une demande de
// proforma. Ouvert par le lien personnel reçu (jeton) : aucun compte, aucune session. Le
// fournisseur ne voit que cette demande et sa propre offre ; une offre soumise n'est plus
// modifiable, sauf si l'acheteur la rouvre (une nouvelle version est alors créée).
import { useEffect, useState } from 'react';
import { api, API_BASE } from '@/lib/api';
import '@/styles/verification.css';

const dateFr = (d, heure = false) => (d ? new Date(d).toLocaleString('fr-FR', heure
  ? { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  : { day: '2-digit', month: 'long', year: 'numeric' }) : '');
const n = (v) => { const x = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const m2 = (x) => Math.round(x * 100) / 100;
const fm = (x, devise = '') => `${Number(x || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${devise ? ` ${devise}` : ''}`;
const fq = (x) => Number(x).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
const virgule = (x) => (x === null || x === undefined ? '' : String(x).replace('.', ','));
const lireFichier = (f) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ko(new Error('Lecture du fichier impossible.')); r.readAsDataURL(f); });

export default function OffreFournisseurPage({ jeton }) {
  const [v, setV] = useState(null);
  const [erreur, setErreur] = useState('');
  const [f, setF] = useState(null);
  const [lignes, setLignes] = useState({});
  const [proforma, setProforma] = useState(null);
  const [envoi, setEnvoi] = useState('');
  const [message, setMessage] = useState('');
  const [fini, setFini] = useState(null);

  const charger = async () => {
    const r = await api.get(`/offres-fournisseurs/${encodeURIComponent(jeton)}`);
    if (r?.error) { setErreur(r.error); return; }
    setV(r);
    const o = r.offre;
    setF({ signataire: o?.signataire || '', delai_livraison_jours: o?.delai_livraison_jours ?? '', delai_type: o?.delai_type || 'calendaires',
      conditions_paiement: o?.conditions_paiement || '', validite_jours: o?.validite_jours ?? (r.consultation.validite_offre_jours || ''), observations: o?.observations || '' });
    setLignes(Object.fromEntries(r.lignes.map((l) => {
      const x = o?.lignes.find((y) => y.consultation_ligne_id === l.id);
      return [l.id, { disponibilite: x?.disponibilite || 'disponible', quantite_proposee: virgule(x?.quantite_proposee ?? ''), prix_unitaire: virgule(x?.prix_unitaire ?? ''),
        taux_taxe: virgule(x?.taux_taxe ?? '19,25'), observation: x?.observation || '' }];
    })));
  };
  useEffect(() => { document.title = 'Demande de proforma — NJ BUSINESS'; charger(); }, [jeton]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const majLigne = (id, k, val) => setLignes((ls) => ({ ...ls, [id]: { ...ls[id], [k]: val } }));
  const calc = (l) => {
    const x = lignes[l.id] || {};
    if (x.disponibilite === 'indisponible') return { ht: 0, tx: 0 };
    const q = x.disponibilite === 'partielle' ? n(x.quantite_proposee) : l.quantite;
    const ht = m2(q * n(x.prix_unitaire));
    return { ht, tx: m2(ht * n(x.taux_taxe) / 100) };
  };
  const totaux = v ? v.lignes.reduce((t, l) => { const c = calc(l); return { ht: t.ht + c.ht, tx: t.tx + c.tx }; }, { ht: 0, tx: 0 }) : { ht: 0, tx: 0 };

  const soumettre = async (e) => {
    e.preventDefault();
    setMessage('');
    if (f.signataire.trim().length < 2) { setMessage('Indiquez votre nom (personne qui soumet l\'offre).'); return; }
    for (const l of v.lignes) {
      const x = lignes[l.id];
      if (x.disponibilite !== 'indisponible' && !(n(x.prix_unitaire) > 0)) { setMessage(`Indiquez le prix unitaire hors taxes de « ${l.designation} », ou déclarez-le indisponible.`); return; }
      if (x.disponibilite === 'partielle' && !(n(x.quantite_proposee) > 0 && n(x.quantite_proposee) <= l.quantite)) { setMessage(`« ${l.designation} » : quantité disponible entre 0 et ${fq(l.quantite)} ${l.unite}.`); return; }
    }
    if (v.lignes.every((l) => lignes[l.id].disponibilite === 'indisponible')) { setMessage('Aucun article proposé : utilisez plutôt « Décliner la consultation ».'); return; }
    if (!window.confirm('Soumettre cette offre ? Une fois envoyée, elle ne pourra plus être modifiée, sauf si l\'acheteur la rouvre.')) return;
    setEnvoi('offre');
    let pj;
    try { pj = proforma ? { nom_fichier: proforma.name, data_base64: await lireFichier(proforma) } : undefined; } catch (err) { setEnvoi(''); setMessage(err.message); return; }
    const r = await api.post(`/offres-fournisseurs/${encodeURIComponent(jeton)}`, { ...f, proforma: pj,
      lignes: v.lignes.map((l) => ({ consultation_ligne_id: l.id, ...lignes[l.id] })) });
    setEnvoi('');
    if (r?.error) { setMessage(r.error); return; }
    setFini({ type: 'offre', version: r.version, le: r.soumise_le });
    window.scrollTo(0, 0);
  };
  const decliner = async () => {
    const motif = window.prompt('Décliner cette consultation ? L\'acheteur en sera informé.\n\nMotif (facultatif) :');
    if (motif === null) return;
    setEnvoi('refus');
    const r = await api.post(`/offres-fournisseurs/${encodeURIComponent(jeton)}/refus`, { motif });
    setEnvoi('');
    if (r?.error) { setMessage(r.error); return; }
    setFini({ type: 'refus' });
  };

  if (erreur) {
    return <div className="njv-page"><div className="njv-carte"><div className="njv-marque">NJ BUSINESS · demande de proforma</div>
      <div className="njv-etat njv-ko"><span className="njv-icone" aria-hidden="true">✕</span><div><h1 className="njv-titre">Lien invalide</h1>
        <p className="njv-texte">{erreur} Vérifiez le lien reçu, ou demandez à l'acheteur de vous le renvoyer.</p></div></div></div></div>;
  }
  if (!v || !f) return <div className="njv-page"><div className="njv-carte"><p className="njv-texte">Chargement de la demande…</p></div></div>;
  const c = v.consultation;
  return (
    <div className="njv-page">
      <div className="njv-carte njp-carte">
        <div className="njv-marque">NJ BUSINESS · demande de proforma</div>
        <div className="njp-tete">
          {v.acheteur.logo_url && <img src={v.acheteur.logo_url} alt="" className="njp-logo" />}
          <div>
            <h1 className="njv-titre">{v.acheteur.nom}</h1>
            <p className="njv-texte">{[v.acheteur.adresse, v.acheteur.telephone, v.acheteur.email].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <p className="njv-texte" style={{ marginBottom: 14 }}>À l'attention de <strong>{v.fournisseur}</strong> : merci d'indiquer vos meilleurs prix pour les articles ci-dessous.</p>
        <dl className="njv-infos">
          <div><dt>Consultation</dt><dd>{c.numero}<span>Demande d'achat {c.demande}</span></dd></div>
          <div><dt>Réponse attendue avant le</dt><dd>{dateFr(c.date_limite)}</dd></div>
          <div><dt>Livraison</dt><dd>{c.livraison || '—'}{c.delai_souhaite && <span>Délai souhaité : {c.delai_souhaite}</span>}</dd></div>
          <div><dt>Validité de l'offre demandée</dt><dd>{c.validite_offre_jours} jours au moins</dd></div>
        </dl>
        {c.conditions_reponse && <p className="njp-conditions">{c.conditions_reponse}</p>}
        <p className="njv-texte" style={{ marginBottom: 16 }}>
          <a className="njp-lien" href={`${API_BASE}/api/offres-fournisseurs/${encodeURIComponent(jeton)}/pdf`} target="_blank" rel="noopener noreferrer">Télécharger la demande en PDF</a>
        </p>

        {fini && (
          <div className="njv-etat njv-ok" role="status"><span className="njv-icone" aria-hidden="true">✓</span><div>
            <h2 className="njv-titre">{fini.type === 'refus' ? 'Réponse enregistrée' : 'Offre reçue, merci'}</h2>
            <p className="njv-texte">{fini.type === 'refus' ? 'L\'acheteur est informé que vous déclinez cette consultation.'
              : `Votre offre (version ${fini.version}) a été enregistrée le ${dateFr(fini.le, true)}. Elle n'est plus modifiable, sauf si l'acheteur la rouvre.`}</p>
          </div></div>
        )}

        {!fini && !v.ouverte && (
          <>
            <div className="njv-etat njv-alerte" role="status"><span className="njv-icone" aria-hidden="true">!</span><div><h2 className="njv-titre">Réponse fermée</h2><p className="njv-texte">{v.raison}</p></div></div>
            {v.offre && (
              <div className="njp-recap">
                <h2>Votre offre (version {v.offre.version}, reçue le {dateFr(v.offre.soumise_le, true)})</h2>
                <table className="njp-table">
                  <thead><tr><th>Article</th><th>Disponibilité</th><th>Prix unitaire HT</th><th>Total HT</th></tr></thead>
                  <tbody>{v.lignes.map((l) => { const x = v.offre.lignes.find((y) => y.consultation_ligne_id === l.id); return (
                    <tr key={l.id}><td>{l.designation}<span>{fq(l.quantite)} {l.unite}</span></td><td>{x?.disponibilite === 'indisponible' ? 'Indisponible' : x?.disponibilite === 'partielle' ? `Partielle (${fq(x.quantite_proposee)})` : 'Disponible'}</td>
                      <td>{x?.prix_unitaire ? fm(x.prix_unitaire) : '—'}</td><td>{x ? fm(x.montant_ht) : '—'}</td></tr>); })}</tbody>
                </table>
                <p className="njp-total">Total HT {fm(v.offre.total_ht, v.devise)} · Taxes {fm(v.offre.total_taxes, v.devise)} · <strong>TTC {fm(v.offre.total_ttc, v.devise)}</strong></p>
              </div>
            )}
          </>
        )}

        {!fini && v.ouverte && (
          <form onSubmit={soumettre} noValidate>
            {v.reouverte && <div className="njv-etat njv-alerte"><span className="njv-icone" aria-hidden="true">!</span><div><p className="njv-texte">L'acheteur a rouvert votre offre : vous pouvez soumettre une nouvelle version. La précédente reste archivée chez lui.</p></div></div>}
            <h2 className="njp-titre2">Vos prix, article par article</h2>
            <p className="njv-texte" style={{ marginBottom: 10 }}>Prix unitaires <strong>hors taxes</strong>, en {v.devise}, dans l'unité indiquée.</p>
            <div className="njp-lignes">
              {v.lignes.map((l) => {
                const x = lignes[l.id];
                const cl = calc(l);
                return (
                  <fieldset key={l.id} className="njp-ligne">
                    <legend><strong>{l.designation}</strong> <span>{l.reference} · {fq(l.quantite)} {l.unite} demandé{l.quantite > 1 ? 's' : ''}</span></legend>
                    <div className="njp-grille">
                      <label>Disponibilité
                        <select value={x.disponibilite} onChange={(e) => majLigne(l.id, 'disponibilite', e.target.value)}>
                          <option value="disponible">Disponible (toute la quantité)</option>
                          <option value="partielle">Partiellement disponible</option>
                          <option value="indisponible">Indisponible</option>
                        </select>
                      </label>
                      {x.disponibilite === 'partielle' && <label>Quantité disponible ({l.unite})<input inputMode="decimal" value={x.quantite_proposee} onChange={(e) => majLigne(l.id, 'quantite_proposee', e.target.value)} /></label>}
                      {x.disponibilite !== 'indisponible' && <>
                        <label>Prix unitaire HT ({v.devise} / {l.unite})<input inputMode="decimal" value={x.prix_unitaire} onChange={(e) => majLigne(l.id, 'prix_unitaire', e.target.value)} required /></label>
                        <label>Taux de taxe (%)<input inputMode="decimal" value={x.taux_taxe} onChange={(e) => majLigne(l.id, 'taux_taxe', e.target.value)} /></label>
                      </>}
                      <label className="njp-pleine">Observation<input value={x.observation} onChange={(e) => majLigne(l.id, 'observation', e.target.value)} maxLength={500} placeholder="Marque, conditionnement, équivalent proposé…" /></label>
                    </div>
                    {x.disponibilite !== 'indisponible' && <p className="njp-montant">Montant HT : <strong>{fm(cl.ht, v.devise)}</strong>{cl.tx ? ` · taxe ${fm(cl.tx, v.devise)}` : ''}</p>}
                  </fieldset>
                );
              })}
            </div>
            <p className="njp-total">Total HT <strong>{fm(m2(totaux.ht), v.devise)}</strong> · Taxes {fm(m2(totaux.tx), v.devise)} · TTC <strong>{fm(m2(totaux.ht + totaux.tx), v.devise)}</strong></p>

            <h2 className="njp-titre2">Conditions de votre offre</h2>
            <div className="njp-grille">
              <label>Délai de livraison (jours)<input inputMode="numeric" value={f.delai_livraison_jours} onChange={(e) => setF((y) => ({ ...y, delai_livraison_jours: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) }))} placeholder="Ex. 5" /></label>
              <label>Type de jours<select value={f.delai_type} onChange={set('delai_type')}><option value="calendaires">Jours calendaires</option><option value="ouvres">Jours ouvrés</option></select></label>
              <label>Conditions de paiement<input value={f.conditions_paiement} onChange={set('conditions_paiement')} maxLength={300} placeholder="Ex. 30 jours fin de mois" /></label>
              <label>Validité de l'offre (jours)<input inputMode="numeric" value={f.validite_jours} onChange={(e) => setF((y) => ({ ...y, validite_jours: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) }))} /></label>
              <label className="njp-pleine">Observations<textarea value={f.observations} onChange={set('observations')} maxLength={2000} /></label>
              <label className="njp-pleine">Facture proforma (PDF, 5 Mo au plus — facultatif)
                <input type="file" accept="application/pdf,.pdf" onChange={(e) => { const x = e.target.files?.[0]; if (x && x.size > 5 * 1024 * 1024) { setMessage('Fichier trop volumineux (5 Mo au plus).'); e.target.value = ''; return; } setProforma(x || null); }} />
              </label>
              <label className="njp-pleine">Votre nom (signataire de l'offre) *<input value={f.signataire} onChange={set('signataire')} maxLength={150} autoComplete="name" required /></label>
            </div>
            {message && <div className="njv-resultat njv-ko njp-erreur" role="alert">{message}</div>}
            <div className="njp-actions">
              <button type="button" className="njp-secondaire" onClick={decliner} disabled={Boolean(envoi)}>{envoi === 'refus' ? 'Envoi…' : 'Décliner la consultation'}</button>
              <button type="submit" className="njv-bouton njp-bouton" disabled={Boolean(envoi)}>{envoi === 'offre' ? 'Envoi…' : 'Soumettre mon offre'}</button>
            </div>
          </form>
        )}
        <p className="njv-pied">Ce lien vous est personnel : ne le transmettez pas. Vos prix ne sont visibles que par l'acheteur ; vous ne voyez pas ceux des autres fournisseurs.</p>
      </div>
    </div>
  );
}
