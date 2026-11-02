// NJ COMMERCIAL — fiche d'un bon de commande : contrôles, PDF, émission, annulation, révision,
// proformas, vérification et historique. Les boutons suivent les droits calculés par le serveur.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Section, fmtMontant, fmtQte } from '@/components/commercial/ui';
import { StatutBon, dateFr, ouvrirFichier, lireFichier, tailleFichier } from '@/components/commercial/achats';

const ACTIONS = {
  COM_BC_PREPARATION: 'Bon préparé', COM_BC_MODIFICATION: 'Brouillon modifié', COM_BC_REVALIDATION: 'Revalidation demandée',
  COM_BC_EMISSION: 'Bon émis', COM_BC_ANNULATION: 'Bon annulé', COM_BC_REVISION: 'Révision préparée', COM_BC_REMPLACE: 'Remplacé par une révision',
  COM_BC_PROFORMA_AJOUT: 'Proforma jointe', COM_BC_PROFORMA_RETRAIT: 'Proforma retirée',
};
const CLASSES = { COM_BC_EMISSION: 'cm-f-ok', COM_BC_ANNULATION: 'cm-f-ko', COM_BC_REVALIDATION: 'cm-f-info', COM_BC_REMPLACE: 'cm-f-info' };

function Controles({ b, onMaj }) {
  const toast = useToast();
  const [enCours, setEnCours] = useState(false);
  const revalider = async () => {
    const mot = window.prompt('La demande repassera dans le circuit d\'autorisation avec le fournisseur et les prix de ce bon.\n\nCommentaire pour le valideur (facultatif) :', '');
    if (mot === null) return;
    setEnCours(true);
    const r = await api.post(`/commercial/bons-commande/${b.id}/revalidation`, { commentaire: mot });
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast('Revalidation demandée : les valideurs des achats sont prévenus.', 'success'); onMaj(r);
  };
  const tousOk = b.controles.every((c) => c.ok);
  return (
    <Section titre="Contrôles avant émission">
      <ul className="cm-controles">
        {b.controles.map((c) => (
          <li key={c.code} className={c.ok ? 'cm-c-ok' : 'cm-c-ko'}>
            <span aria-hidden="true">{c.ok ? '✓' : '✕'}</span>
            <span>{c.message}</span>
          </li>
        ))}
      </ul>
      {b.demande_statut !== 'approuvee' && b.demande_statut === 'examen_achats' && (
        <div className="cm-note" style={{ marginTop: 10, marginBottom: 0 }}>La demande est en cours de revalidation : le bon pourra être émis une fois la demande approuvée à nouveau.</div>
      )}
      {b.droits.revalider && (
        <button type="button" className="cm-btn cm-secondaire" style={{ marginTop: 10 }} onClick={revalider} disabled={enCours}>
          {enCours ? 'Envoi…' : 'Demander une revalidation'}
        </button>
      )}
      {tousOk && !b.droits.emettre_permission && <p className="cm-aide" style={{ marginTop: 8 }}>Tout est conforme. Un responsable des achats peut maintenant émettre ce bon.</p>}
    </Section>
  );
}

function Proformas({ b, onMaj }) {
  const toast = useToast();
  const input = useRef(null);
  const [enCours, setEnCours] = useState(false);
  const proformas = b.documents.filter((x) => x.categorie === 'proforma');
  const joindre = async (e) => {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier) return;
    if (fichier.size > 5 * 1024 * 1024) { toast('Fichier trop volumineux (5 Mo au plus).', 'error'); return; }
    setEnCours(true);
    try {
      const r = await api.post(`/commercial/bons-commande/${b.id}/proformas`, { nom_fichier: fichier.name, data_base64: await lireFichier(fichier) });
      if (r?.error) { toast(r.error, 'error'); return; }
      toast('Proforma jointe.', 'success'); onMaj(r);
    } catch (err) { toast(err.message, 'error'); } finally { setEnCours(false); }
  };
  const retirer = async (p) => {
    const motif = window.prompt(`Retirer « ${p.nom} » ? Le fichier reste conservé et le retrait est tracé.\n\nMotif :`) || '';
    if (!motif.trim()) return;
    const r = await api.post(`/commercial/bons-commande/${b.id}/proformas/${p.id}/retrait`, { motif });
    if (r?.error) { toast(r.error, 'error'); return; }
    onMaj(r);
  };
  return (
    <Section titre={`Proforma du fournisseur (${proformas.filter((p) => !p.retire).length})`}>
      {b.regles?.proforma_obligatoire && b.statut === 'brouillon' && <p className="cm-aide" style={{ marginTop: 0 }}>Exigée avant l'émission.</p>}
      {proformas.length === 0 ? <p className="cm-aide">Aucune proforma jointe.</p> : (
        <ul className="cm-pieces">
          {proformas.map((p) => (
            <li key={p.id} className={p.retire ? 'cm-retiree' : ''} title={p.retire ? `Retirée le ${dateFr(p.retire_le, true)} : ${p.motif_retrait}` : `SHA-256 ${p.sha256}`}>
              <span aria-hidden="true">📎</span>
              <span className="cm-nom">{p.nom}<span className="cm-sous">{tailleFichier(p.taille)} · {p.ajoute_par_nom} · {dateFr(p.ajoute_le)}</span></span>
              {!p.retire && <button type="button" className="cm-lien" onClick={() => ouvrirFichier(api, `/commercial/bons-commande/${b.id}/pieces/${p.id}`, p.nom, p.mime, toast)}>Ouvrir</button>}
              {!p.retire && b.droits.proforma && <button type="button" className="cm-lien" style={{ color: '#b91c1c' }} onClick={() => retirer(p)}>Retirer</button>}
            </li>
          ))}
        </ul>
      )}
      {b.droits.proforma && (
        <>
          <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" onChange={joindre} hidden />
          <button type="button" className="cm-btn cm-secondaire" style={{ marginTop: 10 }} onClick={() => input.current?.click()} disabled={enCours}>
            {enCours ? 'Envoi…' : '+ Joindre la proforma'}
          </button>
        </>
      )}
      {b.statut !== 'brouillon' && <p className="cm-aide" style={{ marginTop: 8 }}>Les pièces d'un bon émis sont figées.</p>}
    </Section>
  );
}

function Verification({ b }) {
  const toast = useToast();
  if (b.statut === 'brouillon') return null;
  const copier = async () => {
    try { await navigator.clipboard.writeText(b.verification_url); toast('Lien de vérification copié.', 'success'); } catch { toast('Copie impossible : sélectionnez le lien.', 'error'); }
  };
  return (
    <Section titre="Vérification">
      <p className="cm-aide" style={{ marginTop: 0 }}>Le QR code du PDF mène à une page publique qui confirme l'authenticité et l'état du bon, sans en révéler les prix.</p>
      {b.verification_url ? (
        <div className="cm-verif-lien">
          <a href={b.verification_url} target="_blank" rel="noopener noreferrer">{b.verification_url.replace(/^https?:\/\//, '').replace(/\/verifier\/(.{8}).*$/, '/verifier/$1…')}</a>
          <button type="button" className="cm-lien" onClick={copier}>Copier</button>
        </div>
      ) : <p className="cm-aide">Adresse de vérification non configurée sur le serveur.</p>}
      <div className="cm-empreinte"><span>Empreinte SHA-256 du PDF</span><code>{b.pdf_sha256}</code></div>
    </Section>
  );
}

export default function BonPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [b, setB] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState('');
  const charger = async () => {
    const r = await api.get(`/commercial/bons-commande/${id}`);
    if (r?.error) { setErreur(r.error); return; }
    setB(r); setErreur('');
  };
  useEffect(() => { setB(null); charger(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const agir = async (cle, appel, message) => {
    setEnCours(cle); setErreur('');
    const r = await appel();
    setEnCours('');
    if (r?.error) { setErreur(r.error); return null; }
    if (message) toast(message, 'success');
    return r;
  };
  const emettre = async () => {
    if (!window.confirm(`Émettre ce bon de commande pour ${b.fournisseur_nom} (${fmtMontant(b.total_ttc, b.devise)} TTC) ?\n\nIl recevra son numéro définitif et son PDF sera figé.`)) return;
    const r = await agir('emettre', () => api.post(`/commercial/bons-commande/${id}/emission`, {}));
    if (r) { toast(`Bon ${r.numero_complet} émis.`, 'success'); setB(r); }
  };
  const annuler = async () => {
    const motif = window.prompt(`Annuler le bon ${b.numero_complet} ?\nLe PDF reste archivé ; la page de vérification indiquera « annulé ».\n\nMotif de l'annulation :`) || '';
    if (!motif.trim()) return;
    const r = await agir('annuler', () => api.post(`/commercial/bons-commande/${id}/annulation`, { motif }), 'Bon annulé.');
    if (r) setB(r);
  };
  const reviser = async () => {
    if (!window.confirm(`Préparer une révision de ${b.numero_complet} ?\n\nUn brouillon est créé à partir de ce bon. À son émission, il portera le numéro ${b.numero}-R${(b.revision || 0) + 1} et ce bon sera marqué « remplacé ».`)) return;
    const r = await agir('reviser', () => api.post(`/commercial/bons-commande/${id}/revision`, {}), 'Révision préparée : modifiez-la puis émettez-la.');
    if (r) navigate(`/commercial/bons/${r.id}/modifier`);
  };
  const supprimer = async () => {
    if (!window.confirm('Supprimer ce brouillon de bon de commande ?')) return;
    const r = await agir('supprimer', () => api.delete(`/commercial/bons-commande/${id}`), 'Brouillon supprimé.');
    if (r) navigate('/commercial/bons');
  };
  const pdf = () => ouvrirFichier(api, `/commercial/bons-commande/${id}/pdf`, `${b.numero_complet}.pdf`, 'application/pdf', toast);

  if (!b) return <div className="cm-page"><Link to="/commercial/bons" className="cm-retour">‹ Bons de commande</Link>{erreur ? <div className="cm-erreur">{erreur}</div> : <div className="loading-msg">Chargement…</div>}</div>;

  const brouillon = b.statut === 'brouillon';
  const parTaxe = Object.values(b.lignes.reduce((m, l) => {
    if (!l.taxe_code) return m;
    const k = `${l.taxe_code}-${l.taxe_taux}`;
    m[k] = { code: l.taxe_code, taux: l.taxe_taux, montant: (m[k]?.montant || 0) + l.montant_taxe };
    return m;
  }, {}));
  const fil = b.historique.map((h) => ({
    le: h.le, cls: CLASSES[h.action] || '', titre: ACTIONS[h.action] || h.action, par: h.par_nom,
    mot: h.nouvelle_valeur?.motif || h.nouvelle_valeur?.nom || (h.nouvelle_valeur?.par ? `par ${h.nouvelle_valeur.par}` : '') || (h.nouvelle_valeur?.revise ? `révise ${h.nouvelle_valeur.revise}` : '') || (h.action === 'COM_BC_EMISSION' ? h.nouvelle_valeur?.numero : '') || '',
  }));

  return (
    <div className="cm-page">
      <Link to="/commercial/bons" className="cm-retour">‹ Bons de commande</Link>
      <div className="cm-fiche-tete">
        <div>
          <h2>
            {!brouillon && <span className="cm-code" style={{ fontSize: 15 }}>{b.numero_complet}</span>}
            Bon de commande <StatutBon statut={b.statut} />
          </h2>
          <span className="cm-sous">
            {brouillon ? `Préparé par ${b.prepare_par_nom || '—'} le ${dateFr(b.cree_le, true)}` : `Émis le ${dateFr(b.emis_le, true)} par ${b.emis_par_nom}`}
            {b.remplace_numero ? ` · révision de ${b.remplace_numero}` : ''}
          </span>
        </div>
        <div className="cm-actions">
          {brouillon && b.droits.modifier && <button type="button" className="cm-btn cm-danger" onClick={supprimer} disabled={Boolean(enCours)}>Supprimer</button>}
          {b.droits.annuler && <button type="button" className="cm-btn cm-danger" onClick={annuler} disabled={Boolean(enCours)}>Annuler le bon</button>}
          {b.droits.reviser && <button type="button" className="cm-btn cm-secondaire" onClick={reviser} disabled={Boolean(enCours)}>Réviser</button>}
          <button type="button" className="cm-btn cm-secondaire" onClick={pdf}>{brouillon ? 'Aperçu PDF' : 'Ouvrir le PDF'}</button>
          {brouillon && b.droits.modifier && <button type="button" className="cm-btn cm-secondaire" onClick={() => navigate(`/commercial/bons/${b.id}/modifier`)}>Modifier</button>}
          {brouillon && b.droits.emettre_permission && (
            <button type="button" className="cm-btn cm-primaire" onClick={emettre} disabled={!b.droits.emettre || Boolean(enCours)}
              title={b.droits.emettre ? '' : 'Tous les contrôles doivent être conformes'}>
              {enCours === 'emettre' ? 'Émission…' : 'Émettre le bon'}
            </button>
          )}
        </div>
      </div>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      {b.statut === 'annule' && <div className="cm-erreur"><strong>Bon annulé</strong> le {dateFr(b.annule_le, true)} par {b.annule_par_nom} : « {b.motif_annulation} »</div>}
      {b.statut === 'remplace' && b.remplace_par_id && (
        <div className="cm-note">Ce bon a été remplacé par la révision <Link to={`/commercial/bons/${b.remplace_par_id}`}>{b.remplace_par_numero}</Link>.</div>
      )}
      {b.statut === 'emis' && b.remplace_par_id && (
        <div className="cm-note">Une révision est en préparation : <Link to={`/commercial/bons/${b.remplace_par_id}`}>ouvrir le brouillon</Link>.</div>
      )}

      <div className="cm-deux">
        <div>
          {brouillon && <Controles b={b} onMaj={setB} />}
          <Section titre="Commande">
            <dl className="cm-infos">
              <div><dt>Fournisseur</dt><dd>{b.fournisseur_nom}</dd></div>
              <div><dt>Livraison</dt><dd>{b.magasin_code} — {b.magasin_nom}</dd></div>
              <div><dt>Demande d'origine</dt><dd><Link to={`/commercial/demandes/${b.demande_id}`}>{b.demande_numero}</Link><span className="cm-sous">{b.demandeur_nom}{b.service ? ` · ${b.service}` : ''}</span></dd></div>
              <div><dt>Conditions de paiement</dt><dd>{b.conditions_paiement || '—'}</dd></div>
              <div><dt>Délai de livraison</dt><dd>{b.delai_livraison || '—'}</dd></div>
              <div><dt>Devise</dt><dd>{b.devise}</dd></div>
            </dl>
            {b.observations && <p className="cm-aide" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}><strong>Observations :</strong> {b.observations}</p>}
            {!brouillon && b.autorisation && <p className="cm-aide" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}><strong>Autorisation :</strong> {b.autorisation}</p>}
          </Section>
          <Section titre={`Lignes (${b.lignes.length})`}>
            <table className="cm-lignes cm-bc-lecture">
              <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Quantité</th><th style={{ textAlign: 'right' }}>P.U. HT</th><th style={{ textAlign: 'right' }}>Rem.</th><th>Taxe</th><th style={{ textAlign: 'right' }}>Montant HT</th></tr></thead>
              <tbody>
                {b.lignes.map((l) => (
                  <tr key={l.id}>
                    <td className="cm-l-article"><strong>{l.designation}</strong><span className="cm-sous">{l.reference}</span></td>
                    <td className="cm-num"><span className="cm-l-lib">Qté</span>{fmtQte(l.quantite)} {l.unite}{l.coefficient !== 1 && <span className="cm-conv">= {fmtQte(l.quantite_stock)} {l.unite_stock}</span>}</td>
                    <td className="cm-num"><span className="cm-l-lib">P.U. HT</span>{fmtMontant(l.prix_unitaire, '')}</td>
                    <td className="cm-num"><span className="cm-l-lib">Rem.</span>{l.remise_pct ? `${String(l.remise_pct).replace('.', ',')} %` : '—'}</td>
                    <td><span className="cm-l-lib">Taxe</span>{l.taxe_code ? `${l.taxe_code} ${String(l.taxe_taux).replace('.', ',')} %` : '—'}</td>
                    <td className="cm-num"><span className="cm-l-lib">Montant HT</span><strong>{fmtMontant(l.montant_ht, '')}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="cm-totaux">
              <div><span>Total HT</span><strong>{fmtMontant(b.total_ht, b.devise)}</strong></div>
              {parTaxe.map((t) => <div key={`${t.code}-${t.taux}`}><span>{t.code} {String(t.taux).replace('.', ',')} %</span><strong>{fmtMontant(t.montant, b.devise)}</strong></div>)}
              <div className="cm-ttc"><span>Total TTC</span><strong>{fmtMontant(b.total_ttc, b.devise)}</strong></div>
            </div>
          </Section>
        </div>
        <div>
          <Verification b={b} />
          <Proformas b={b} onMaj={setB} />
          <Section titre="Historique">
            <ol className="cm-fil">
              {fil.map((e, i) => (
                <li key={i} className={e.cls}>
                  <strong>{e.titre}</strong>
                  <span className="cm-quand">{dateFr(e.le, true)} · {e.par || 'système'}</span>
                  {e.mot && <div className="cm-mot">{e.mot}</div>}
                </li>
              ))}
            </ol>
            <p className="cm-aide">Cet historique ne peut être ni modifié ni effacé.</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
