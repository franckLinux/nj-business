// NJ COMMERCIAL — préparation d'un bon de commande (nouveau, à partir d'une demande approuvée,
// ou brouillon existant). Les totaux affichés sont indicatifs : le serveur recalcule tout.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Section, Champ, fmtMontant, fmtQte } from '@/components/commercial/ui';

const num = (v) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const decimales = (devise) => (['FCFA', 'XAF', 'XOF', 'CFA'].includes(String(devise || '').toUpperCase()) ? 0 : 2);
const arrondi = (n, d) => { const f = 10 ** d; return Math.round(n * f) / f; };
const enSaisie = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

export default function BonFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [refs, setRefs] = useState(null);
  const [ctx, setCtx] = useState(null);     // { demande, devise, tolerance, numero }
  const [f, setF] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    (async () => {
      const [fo, ma, tx] = await Promise.all([
        api.get('/commercial/tiers?type=fournisseur&actifs=1'), api.get('/commercial/magasins?actifs=1&perimetre=1'), api.get('/commercial/taxes?actifs=1'),
      ]);
      const r = { fournisseurs: fo?.error ? [] : fo, magasins: ma?.error ? [] : ma, taxes: tx?.error ? [] : tx.filter((t) => t.usage !== 'vente') };
      setRefs(r);
      if (id) {
        const b = await api.get(`/commercial/bons-commande/${id}`);
        if (b?.error) { setErreur(b.error); return; }
        if (!b.droits.modifier) { navigate(`/commercial/bons/${id}`, { replace: true }); return; }
        setCtx({ demande: { id: b.demande_id, numero: b.demande_numero }, devise: b.devise, tolerance: b.regles?.tolerance, revise: b.remplace_numero });
        setF({ fournisseur_id: String(b.fournisseur_id), magasin_id: String(b.magasin_id), conditions_paiement: b.conditions_paiement || '',
          delai_livraison: b.delai_livraison || '', observations: b.observations || '' });
        const dans = new Map(b.lignes.map((l) => [l.demande_ligne_id, l]));
        setLignes(b.disponibles.filter((d) => d.reste > 0 || dans.has(d.demande_ligne_id)).map((d) => {
          const l = dans.get(d.demande_ligne_id);
          return { ...d, inclus: Boolean(l), quantite: enSaisie(l ? l.quantite : d.reste), prix_unitaire: enSaisie(l ? l.prix_unitaire : d.prix_approuve),
            remise_pct: enSaisie(l ? l.remise_pct : 0), taxe_id: String((l ? l.taxe_id : d.taxe_id) || '') };
        }));
      } else {
        const demandeId = params.get('demande');
        if (!demandeId) { setErreur('Choisissez d\'abord une demande approuvée (onglet « À commander »).'); return; }
        const p = await api.get(`/commercial/bons-commande/proposition/${demandeId}`);
        if (p?.error) { setErreur(p.error); return; }
        const fournisseur = p.fournisseurs_retenus[0] || p.demande.fournisseur_propose_id || '';
        const fiche = r.fournisseurs.find((x) => x.id === Number(fournisseur));
        setCtx({ demande: p.demande, devise: p.devise, tolerance: p.tolerance, proforma: p.proforma_obligatoire, plusieurs: p.fournisseurs_retenus.length > 1 });
        setF({ fournisseur_id: String(fournisseur), magasin_id: String(p.demande.magasin_id), conditions_paiement: fiche?.conditions_paiement || '',
          delai_livraison: '', observations: '' });
        setLignes(p.lignes.map((d) => ({ ...d, inclus: !d.fournisseur_id || d.fournisseur_id === Number(fournisseur),
          quantite: enSaisie(d.reste), prix_unitaire: enSaisie(d.prix_approuve), remise_pct: '0', taxe_id: String(d.taxe_id || '') })));
      }
    })();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dec = decimales(ctx?.devise);
  const taxeDe = (tid) => refs?.taxes.find((x) => x.id === Number(tid));
  const calcul = useMemo(() => {
    let ht = 0; const parTaxe = new Map();
    const parLigne = lignes.map((l) => {
      if (!l.inclus) return null;
      const mht = arrondi(num(l.quantite) * num(l.prix_unitaire) * (1 - num(l.remise_pct) / 100), dec);
      const t = taxeDe(l.taxe_id);
      const mtx = t ? arrondi(mht * t.taux / 100, dec) : 0;
      ht += mht;
      if (t) parTaxe.set(t.id, { code: t.code, taux: t.taux, montant: (parTaxe.get(t.id)?.montant || 0) + mtx });
      return { mht, net: num(l.prix_unitaire) * (1 - num(l.remise_pct) / 100) };
    });
    const tx = [...parTaxe.values()].reduce((s, x) => s + x.montant, 0);
    return { parLigne, ht: arrondi(ht, dec), taxes: [...parTaxe.values()], ttc: arrondi(ht + tx, dec) };
  }, [lignes, refs, dec]); // eslint-disable-line react-hooks/exhaustive-deps

  const maj = (i, champ, v) => setLignes((ls) => ls.map((l, k) => (k === i ? { ...l, [champ]: v } : l)));
  const choisirFournisseur = (v) => {
    const fiche = refs.fournisseurs.find((x) => x.id === Number(v));
    setF((x) => ({ ...x, fournisseur_id: v, conditions_paiement: x.conditions_paiement || fiche?.conditions_paiement || '' }));
  };

  const enregistrer = async () => {
    setErreur('');
    const choisies = lignes.filter((l) => l.inclus);
    if (!f.fournisseur_id) { setErreur('Choisissez le fournisseur.'); return; }
    if (!choisies.length) { setErreur('Cochez au moins une ligne de la demande.'); return; }
    for (const l of choisies) {
      const q = num(l.quantite);
      if (!(q > 0)) { setErreur(`« ${l.designation} » : indiquez une quantité.`); return; }
      if (q > l.reste + 1e-9) { setErreur(`« ${l.designation} » : ${fmtQte(q)} commandé(s) pour ${fmtQte(l.reste)} restant(s).`); return; }
    }
    const corps = {
      ...f, demande_id: ctx.demande.id, fournisseur_id: Number(f.fournisseur_id), magasin_id: Number(f.magasin_id),
      lignes: choisies.map((l) => ({ demande_ligne_id: l.demande_ligne_id, quantite: num(l.quantite), prix_unitaire: l.prix_unitaire === '' ? null : num(l.prix_unitaire),
        remise_pct: num(l.remise_pct), taxe_id: l.taxe_id ? Number(l.taxe_id) : null })),
    };
    setEnCours(true);
    const r = id ? await api.put(`/commercial/bons-commande/${id}`, corps) : await api.post('/commercial/bons-commande', corps);
    setEnCours(false);
    if (r?.error) { setErreur(r.error); return; }
    toast(id ? 'Brouillon enregistré.' : 'Bon préparé : vérifiez les contrôles avant l\'émission.', 'success');
    navigate(`/commercial/bons/${r.id}`, { replace: true });
  };

  const retour = id ? `/commercial/bons/${id}` : '/commercial/bons';
  if (!f || !refs) {
    return <div className="cm-page"><Link to={retour} className="cm-retour">‹ Bons de commande</Link>{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;
  }
  const fournisseurChoisi = Number(f.fournisseur_id);

  return (
    <div className="cm-page">
      <Link to={retour} className="cm-retour">‹ {id ? 'Retour au bon' : 'Bons de commande'}</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2>{id ? 'Modifier le bon de commande' : 'Préparer un bon de commande'}</h2>
          <span className="cm-sous">À partir de la demande <Link to={`/commercial/demandes/${ctx.demande.id}`}>{ctx.demande.numero}</Link>
            {ctx.revise ? ` · révision de ${ctx.revise}` : ''} · le numéro définitif est attribué à l'émission</span>
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      {ctx.plusieurs && <div className="cm-note">Plusieurs fournisseurs ont été retenus pour cette demande : préparez un bon par fournisseur. Seules les lignes du fournisseur choisi sont cochées.</div>}

      <Section titre="En-tête">
        <div className="cm-grille">
          <Champ label="Fournisseur" requis id="bc-f">
            <select id="bc-f" value={f.fournisseur_id} onChange={(e) => choisirFournisseur(e.target.value)}>
              <option value="">— Choisir —</option>
              {refs.fournisseurs.map((x) => <option key={x.id} value={x.id}>{x.nom}{x.code ? ` (${x.code})` : ''}</option>)}
            </select>
          </Champ>
          <Champ label="Lieu de livraison" requis id="bc-m">
            <select id="bc-m" value={f.magasin_id} onChange={(e) => setF({ ...f, magasin_id: e.target.value })}>
              {refs.magasins.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.nom}</option>)}
            </select>
          </Champ>
          <Champ label="Conditions de paiement" id="bc-c" aide="Reprises de la fiche du fournisseur ; modifiables.">
            <input id="bc-c" value={f.conditions_paiement} maxLength={300} onChange={(e) => setF({ ...f, conditions_paiement: e.target.value })} placeholder="Ex. 30 jours fin de mois" />
          </Champ>
          <Champ label="Délai de livraison" id="bc-d">
            <input id="bc-d" value={f.delai_livraison} maxLength={200} onChange={(e) => setF({ ...f, delai_livraison: e.target.value })} placeholder="Ex. sous 10 jours" />
          </Champ>
          <Champ label="Observations (imprimées sur le bon)" pleine id="bc-o">
            <textarea id="bc-o" value={f.observations} maxLength={2000} onChange={(e) => setF({ ...f, observations: e.target.value })} />
          </Champ>
        </div>
      </Section>

      <Section titre="Lignes">
        <table className="cm-lignes cm-bc-lignes">
          <thead><tr><th /><th>Article</th><th style={{ textAlign: 'right' }}>Quantité</th><th style={{ textAlign: 'right' }}>P.U. HT</th><th style={{ textAlign: 'right' }}>Remise %</th><th>Taxe</th><th style={{ textAlign: 'right' }}>Montant HT</th></tr></thead>
          <tbody>
            {lignes.map((l, i) => {
              const c = calcul.parLigne[i];
              const autreFournisseur = l.fournisseur_id && l.fournisseur_id !== fournisseurChoisi;
              const horsPrix = c && l.prix_approuve !== null && c.net > l.prix_approuve * (1 + (ctx.tolerance ?? 0) / 100) + 1e-6;
              return (
                <tr key={l.demande_ligne_id} className={l.inclus ? '' : 'cm-ligne-off'}>
                  <td className="cm-l-case"><input type="checkbox" checked={l.inclus} onChange={(e) => maj(i, 'inclus', e.target.checked)} aria-label={`Inclure ${l.designation}`} /></td>
                  <td className="cm-l-article">
                    <strong>{l.designation}</strong>
                    <span className="cm-sous">{l.reference} · reste {fmtQte(l.reste)} / {fmtQte(l.approuve)} {l.unite} approuvé{l.approuve > 1 ? 's' : ''}
                      {l.prix_approuve !== null ? ` · prix approuvé ${fmtMontant(l.prix_approuve, ctx.devise)}` : ' · aucun prix approuvé'}</span>
                    {l.inclus && autreFournisseur && <span className="cm-stock-ligne cm-orange" style={{ marginTop: 4 }}>Autre fournisseur retenu pour cette ligne</span>}
                    {l.inclus && horsPrix && <span className="cm-stock-ligne cm-orange" style={{ marginTop: 4 }}>Prix au-delà de l'approuvé + {ctx.tolerance} % : revalidation nécessaire</span>}
                  </td>
                  <td className="cm-l-num"><span className="cm-l-lib">Quantité</span><input className="cm-qte-input" inputMode="decimal" value={l.quantite} disabled={!l.inclus} onChange={(e) => maj(i, 'quantite', e.target.value)} aria-label={`Quantité ${l.designation}`} /><span className="cm-sous" style={{ textAlign: 'right' }}>{l.unite}</span></td>
                  <td className="cm-l-num"><span className="cm-l-lib">P.U. HT</span><input className="cm-qte-input" inputMode="decimal" value={l.prix_unitaire} disabled={!l.inclus} onChange={(e) => maj(i, 'prix_unitaire', e.target.value)} aria-label={`Prix unitaire ${l.designation}`} /></td>
                  <td className="cm-l-num"><span className="cm-l-lib">Remise %</span><input className="cm-qte-input cm-court" inputMode="decimal" value={l.remise_pct} disabled={!l.inclus} onChange={(e) => maj(i, 'remise_pct', e.target.value)} aria-label={`Remise ${l.designation}`} /></td>
                  <td className="cm-l-num"><span className="cm-l-lib">Taxe</span>
                    <select value={l.taxe_id} disabled={!l.inclus} onChange={(e) => maj(i, 'taxe_id', e.target.value)} aria-label={`Taxe ${l.designation}`}>
                      <option value="">Aucune</option>
                      {refs.taxes.map((t) => <option key={t.id} value={t.id}>{t.code} {String(t.taux).replace('.', ',')} %</option>)}
                    </select>
                  </td>
                  <td className="cm-l-num cm-num"><span className="cm-l-lib">Montant HT</span><strong>{c ? fmtMontant(c.mht, ctx.devise) : '—'}</strong></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {lignes.length === 0 && <p className="cm-aide">Toutes les quantités approuvées de cette demande sont déjà commandées.</p>}
        <div className="cm-totaux">
          <div><span>Total HT</span><strong>{fmtMontant(calcul.ht, ctx.devise)}</strong></div>
          {calcul.taxes.map((t) => <div key={t.code}><span>{t.code} {String(t.taux).replace('.', ',')} %</span><strong>{fmtMontant(arrondi(t.montant, dec), ctx.devise)}</strong></div>)}
          <div className="cm-ttc"><span>Total TTC</span><strong>{fmtMontant(calcul.ttc, ctx.devise)}</strong></div>
        </div>
        <p className="cm-aide" style={{ marginTop: 8 }}>Montants indicatifs : le serveur les recalcule à l'enregistrement. Une quantité ne peut jamais dépasser le reste approuvé.</p>
      </Section>

      <div className="cm-actions" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="cm-btn cm-secondaire" onClick={() => navigate(retour)}>Annuler</button>
        <button type="button" className="cm-btn cm-primaire" onClick={enregistrer} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer le brouillon'}</button>
      </div>
    </div>
  );
}
