// NJ BUSINESS — Configuration de l'entreprise (migration 064, lot A).
//
// Espace du SOCLE, indépendant des modules : il s'ouvre depuis l'accueil, même
// quand aucun module n'est activé. L'identité saisie ici est la seule source :
// la caisse, le commercial et les modules futurs la lisent pour leurs documents.
// Les réglages propres à un module (plan comptable, périodicité budgétaire,
// magasins, taxes…) restent dans la configuration de ce module.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { lignesEntite } from '@/lib/print';
import { preparerImage } from '@/lib/images';
import { utiliseAccueil } from '@/lib/modules';
import MonCompteModal from '@/components/MonCompteModal';
import '@/styles/entreprise.css';

const ONGLETS = [
  { id: 'identite', libelle: 'Identité' },
  { id: 'legal', libelle: 'Informations légales' },
  { id: 'representant', libelle: 'Représentant légal' },
];

// [clé, libellé, longueur max, options]
const IDENTITE = [
  ['nom', 'Raison sociale', 200, { requis: true, large: true }],
  ['nom_commercial', 'Nom commercial', 150, { aide: 'Nom affiché en tête des documents, s\'il diffère de la raison sociale.' }],
  ['sigle', 'Sigle', 30, { majuscules: true }],
  ['slogan', 'Slogan', 200, { large: true, aide: 'Facultatif.' }],
  ['forme_juridique', 'Forme juridique', 20, { type: 'forme' }],
  ['activite', 'Secteur d\'activité', 200, { placeholder: 'Ex : Commerce général' }],
  ['date_creation', 'Date de création', 10, { type: 'date' }],
  ['devise', 'Devise principale', 4, { type: 'devise' }],
];
const COORDONNEES = [
  ['pays', 'Pays', 100],
  ['region', 'Région', 100, { placeholder: 'Ex : Centre' }],
  ['ville', 'Ville', 100],
  ['boite_postale', 'Boîte postale', 60, { placeholder: 'Ex : BP 1234' }],
  ['adresse', 'Adresse complète', 300, { large: true, placeholder: 'Rue, quartier, repère' }],
  ['telephone', 'Téléphone principal', 60, { type: 'tel', placeholder: '+237 6 99 00 00 00' }],
  ['email', 'E-mail professionnel', 150, { type: 'email' }],
  ['site_web', 'Site internet', 200, { placeholder: 'www.entreprise.cm', large: true }],
];
const LEGAL = [
  ['nui', 'Numéro de contribuable (NIU)', 20, { majuscules: true, placeholder: 'Ex : M050000123456P' }],
  ['registre_commerce', 'Numéro RCCM', 80, { placeholder: 'Ex : RC/YDE/2024/B/123' }],
  ['immatriculation', 'Numéro d\'immatriculation', 80],
  ['numero_statistique', 'Numéro d\'identification statistique', 80, { aide: 'Si applicable.' }],
  ['agrement', 'Référence d\'agrément', 120, { aide: 'Si applicable (CGA, agrément sectoriel…).', large: true }],
];
const REPRESENTANT = [
  ['nom', 'Nom', 120, { requis: true }],
  ['prenoms', 'Prénom(s)', 150],
  ['fonction', 'Fonction', 120, { placeholder: 'Ex : Directeur général, Gérant' }],
  ['telephone', 'Téléphone', 60, { type: 'tel' }],
  ['email', 'E-mail', 150, { type: 'email' }],
  ['adresse', 'Adresse', 300, { large: true, aide: 'Si nécessaire.' }],
];
const CHAMPS_IDENTITE = [...IDENTITE, ...COORDONNEES].map(([k]) => k);
const CHAMPS_LEGAL = LEGAL.map(([k]) => k);
const vide = (champs) => Object.fromEntries(champs.map(([k]) => [k, '']));
const dateFr = (d) => (d ? d.split('-').reverse().join('/') : '');
const aujourdhui = () => new Date().toISOString().slice(0, 10);

function Champ({ def, valeur, onChange, lecture, formes, devises }) {
  const [k, libelle, max, o = {}] = def;
  const id = `ent-${k}`;
  let saisie;
  if (o.type === 'forme') {
    saisie = (
      <select id={id} value={valeur} onChange={(e) => onChange(k, e.target.value)} disabled={lecture}>
        <option value="">— Choisir —</option>
        {formes.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
      </select>
    );
  } else if (o.type === 'devise') {
    saisie = (
      <select id={id} value={valeur} onChange={(e) => onChange(k, e.target.value)} disabled={lecture}>
        {devises.map((d) => <option key={d} value={d}>{d === 'FCFA' ? 'FCFA (XAF)' : d}</option>)}
      </select>
    );
  } else {
    saisie = (
      <input id={id} type={o.type || 'text'} value={valeur} maxLength={max} placeholder={lecture ? '' : o.placeholder}
        max={o.type === 'date' ? aujourdhui() : undefined} required={o.requis} readOnly={lecture}
        style={o.majuscules ? { textTransform: 'uppercase' } : undefined}
        onChange={(e) => onChange(k, e.target.value)} />
    );
  }
  return (
    <div className={'nje-champ' + (o.large ? ' nje-large' : '')}>
      <label htmlFor={id}>{libelle}{o.requis && <span className="nje-requis" aria-hidden="true"> *</span>}</label>
      {saisie}
      {o.aide && <span className="nje-aide">{o.aide}</span>}
    </div>
  );
}

function Grille({ defs, valeurs, onChange, lecture, formes = [], devises = [] }) {
  return (
    <div className="nje-grille">
      {defs.map((d) => <Champ key={d[0]} def={d} valeur={valeurs[d[0]] ?? ''} onChange={onChange} lecture={lecture} formes={formes} devises={devises} />)}
    </div>
  );
}

function ImageChoix({ titre, image, aide, lecture, onChoisir, onRetirer, options, alt, enCours }) {
  const toast = useToast();
  const choisir = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { onChoisir(await preparerImage(f, options)); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <div className="nje-image">
      <div className="nje-image-cadre">
        {image ? <img src={image} alt={alt} /> : <span>{titre} : aucun</span>}
      </div>
      <div className="nje-image-texte">
        <p>{aide}</p>
        {!lecture && (
          <div className="nje-actions-ligne">
            <label className="nje-btn nje-secondaire">
              {image ? 'Remplacer' : 'Importer'}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={choisir} disabled={enCours} hidden />
            </label>
            {image && <button type="button" className="nje-btn nje-danger" onClick={onRetirer} disabled={enCours}>Supprimer</button>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function EntreprisePage() {
  const { user, can, setDevise, rechargerEntite, logout } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const modifiable = can('entreprise.edit');
  const [onglet, setOnglet] = useState('identite');
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [ident, setIdent] = useState(null);
  const [refs, setRefs] = useState([]);
  const [rep, setRep] = useState(null);
  const [nouveau, setNouveau] = useState(null);    // formulaire de changement de représentant
  const [enCours, setEnCours] = useState(false);
  const [monCompte, setMonCompte] = useState(false);

  const appliquer = (r) => {
    setD(r);
    setIdent(Object.fromEntries([...CHAMPS_IDENTITE, ...CHAMPS_LEGAL].map((k) => [k, r.identite[k] ?? ''])));
    setRefs(r.references.map(({ libelle, valeur }) => ({ libelle, valeur })));
    setRep(r.representant ? { ...vide(REPRESENTANT), ...r.representant } : null);
  };
  useEffect(() => {
    document.title = 'Configuration de l\'entreprise — NJ BUSINESS';
    api.get('/entreprise').then((r) => (r?.error ? setErreur(r.error) : appliquer(r)));
  }, []);

  const lecture = !modifiable;
  const set = (k, v) => setIdent((x) => ({ ...x, [k]: v }));
  const modifie = useMemo(() => {
    if (!d || !ident) return false;
    const champs = onglet === 'legal' ? CHAMPS_LEGAL : CHAMPS_IDENTITE;
    if (champs.some((k) => String(ident[k] ?? '') !== String(d.identite[k] ?? ''))) return true;
    return onglet === 'legal' && JSON.stringify(refs) !== JSON.stringify(d.references.map(({ libelle, valeur }) => ({ libelle, valeur })));
  }, [d, ident, refs, onglet]);

  const apres = (r, message) => {
    if (r?.error) { toast(r.error, 'error', 7000); return false; }
    appliquer(r);
    setDevise?.(r.identite.devise);
    rechargerEntite?.();
    toast(message, 'success');
    return true;
  };

  const enregistrer = async (e) => {
    e?.preventDefault();
    const champs = onglet === 'legal' ? CHAMPS_LEGAL : CHAMPS_IDENTITE;
    const corps = Object.fromEntries(champs.map((k) => [k, ident[k]]));
    if (onglet === 'legal') corps.references = refs.filter((r) => r.libelle.trim() || r.valeur.trim());
    setEnCours(true);
    const r = await api.put('/entreprise', corps);
    setEnCours(false);
    // La forme juridique décide de la rubrique « Gestion des activités » (ONG, associations) :
    // le menu se met à jour sans recharger la page.
    if (!r?.error) window.dispatchEvent(new Event('nj:entite-modifiee'));
    apres(r, 'Configuration de l\'entreprise enregistrée.');
  };

  const logo = async (valeur) => {
    if (!valeur && !window.confirm('Supprimer le logo ? Les prochains documents seront imprimés sans logo.')) return;
    setEnCours(true);
    const r = valeur ? await api.put('/entreprise/logo', { logo: valeur }) : await api.delete('/entreprise/logo');
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error', 7000); return; }
    // Seul le logo change : les saisies en cours dans le formulaire sont conservées.
    setD((x) => ({ ...x, identite: { ...x.identite, logo_url: r.identite.logo_url } }));
    rechargerEntite?.();
    toast(valeur ? 'Logo enregistré.' : 'Logo supprimé.', 'success');
  };

  const corrigerRepresentant = async (e) => {
    e.preventDefault();
    setEnCours(true);
    const r = await api.put('/entreprise/representant', rep);
    setEnCours(false);
    apres(r, 'Représentant légal mis à jour.');
  };
  const changerRepresentant = async (e) => {
    e.preventDefault();
    setEnCours(true);
    const r = await api.post('/entreprise/representants', nouveau);
    setEnCours(false);
    if (apres(r, 'Nouveau représentant légal enregistré.')) setNouveau(null);
  };

  const retour = () => navigate(utiliseAccueil(user) ? '/accueil' : '/');
  const deconnexion = () => { if (window.confirm('Se déconnecter ?')) { logout(); navigate('/', { replace: true }); } };
  const apercu = ident ? lignesEntite(ident) : { coord: [], legal: [] };

  return (
    <div className="njb-accueil">
      <header className="njb-barre">
        <img src="/brand/nj-business-logo-fond-sombre.svg" alt="NJ BUSINESS" />
        <div className="njb-barre-droite">
          <span className="njb-utilisateur"><b>{user?.username}</b></span>
          <button type="button" className="njb-barre-btn" onClick={retour}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
            <span>{utiliseAccueil(user) ? 'Accueil' : 'Retour'}</span>
          </button>
          {utiliseAccueil(user) && (
            <>
              <button type="button" className="njb-barre-btn" onClick={() => setMonCompte(true)} aria-label="Mon profil">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
                <span>Mon profil</span>
              </button>
              <button type="button" className="njb-barre-btn" onClick={deconnexion} aria-label="Se déconnecter">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                <span>Se déconnecter</span>
              </button>
            </>
          )}
        </div>
      </header>

      <main className="njb-contenu nje">
        <h1>Configuration de l'entreprise</h1>
        <p className="njb-espace">
          Informations communes à tous les modules : elles figurent sur les documents de la caisse, du commercial et des modules à venir.
          Elles ne se saisissent qu'ici.
        </p>

        {erreur && <div className="njb-alerte" role="alert">{erreur}</div>}
        {!d && !erreur && <div className="loading-msg">Chargement…</div>}

        {d && ident && (
          <>
            {lecture && <div className="nje-info" role="status">Vous consultez ces informations. Seule une personne habilitée peut les modifier.</div>}
            {d.modules_actifs === 0 && modifiable && <div className="nje-info" role="status">Aucun module n'est encore activé pour cette entreprise : vous pouvez déjà renseigner sa configuration.</div>}

            <div className="nje-onglets" role="tablist" aria-label="Rubriques">
              {ONGLETS.map((o) => (
                <button key={o.id} type="button" role="tab" id={`tab-${o.id}`} aria-selected={onglet === o.id} aria-controls={`pan-${o.id}`}
                  className={'nje-onglet' + (onglet === o.id ? ' actif' : '')}
                  onClick={() => { if (onglet !== o.id && modifie && !window.confirm('Des modifications ne sont pas enregistrées. Changer de rubrique quand même ?')) return; if (onglet !== o.id) appliquer(d); setOnglet(o.id); }}>
                  {o.libelle}
                </button>
              ))}
            </div>

            {onglet === 'identite' && (
              <form id="pan-identite" role="tabpanel" aria-labelledby="tab-identite" onSubmit={enregistrer} className="nje-panneau">
                <section className="nje-carte">
                  <h2>Logo</h2>
                  <ImageChoix titre="Logo" image={d.identite.logo_url} alt="Logo de l'entreprise" lecture={lecture} enCours={enCours}
                    aide="Il apparaît en tête des factures, devis, bons de commande, reçus, rapports et documents PDF de tous les modules. PNG à fond transparent conseillé, JPEG ou WebP ; l'image est redimensionnée automatiquement."
                    onChoisir={logo} onRetirer={() => logo(null)} />
                </section>
                <section className="nje-carte">
                  <h2>Identité</h2>
                  <Grille defs={IDENTITE} valeurs={ident} onChange={set} lecture={lecture} formes={d.formes_juridiques} devises={d.devises} />
                </section>
                <section className="nje-carte">
                  <h2>Coordonnées</h2>
                  <Grille defs={COORDONNEES} valeurs={ident} onChange={set} lecture={lecture} />
                </section>
                <section className="nje-carte nje-apercu">
                  <h2>Aperçu de l'en-tête des documents</h2>
                  <div className="nje-entete">
                    {d.identite.logo_url && <img src={d.identite.logo_url} alt="" />}
                    <div>
                      <div className="nje-entete-nom">{ident.nom_commercial || ident.nom || 'Raison sociale'}{ident.sigle && <small> ({ident.sigle.toUpperCase()})</small>}</div>
                      {ident.slogan && <div className="nje-entete-slogan">{ident.slogan}</div>}
                      <div className="nje-entete-l">{apercu.coord.join(' · ') || 'Adresse · BP · Téléphone · E-mail'}</div>
                      {apercu.legal.length > 0 && <div className="nje-entete-l">{apercu.legal.join(' · ')}</div>}
                    </div>
                  </div>
                </section>
                {modifiable && (
                  <div className="nje-pied">
                    <span>{modifie ? 'Modifications non enregistrées' : 'Tout est enregistré'}</span>
                    <button type="submit" className="nje-btn nje-primaire" disabled={enCours || !modifie}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
                  </div>
                )}
              </form>
            )}

            {onglet === 'legal' && (
              <form id="pan-legal" role="tabpanel" aria-labelledby="tab-legal" onSubmit={enregistrer} className="nje-panneau">
                <section className="nje-carte">
                  <h2>Références légales et administratives</h2>
                  <p className="nje-note">Aucune n'est obligatoire : renseignez celles qui s'appliquent à l'entreprise.</p>
                  <Grille defs={LEGAL} valeurs={ident} onChange={set} lecture={lecture} />
                </section>
                <section className="nje-carte">
                  <h2>Autres références</h2>
                  <p className="nje-note">N° CNPS employeur, agrément sectoriel, licence… jusqu'à 20 références.</p>
                  {refs.length === 0 && <p className="nje-vide">Aucune autre référence.</p>}
                  {refs.map((r, i) => (
                    <div key={i} className="nje-ref">
                      <div className="nje-champ">
                        <label htmlFor={`ref-l-${i}`}>Libellé</label>
                        <input id={`ref-l-${i}`} value={r.libelle} maxLength={80} readOnly={lecture} placeholder="Ex : N° CNPS employeur"
                          onChange={(e) => setRefs((x) => x.map((y, j) => (j === i ? { ...y, libelle: e.target.value } : y)))} />
                      </div>
                      <div className="nje-champ">
                        <label htmlFor={`ref-v-${i}`}>Valeur</label>
                        <input id={`ref-v-${i}`} value={r.valeur} maxLength={120} readOnly={lecture}
                          onChange={(e) => setRefs((x) => x.map((y, j) => (j === i ? { ...y, valeur: e.target.value } : y)))} />
                      </div>
                      {!lecture && <button type="button" className="nje-btn nje-lien-danger" aria-label={`Retirer la référence ${i + 1}`} onClick={() => setRefs((x) => x.filter((_, j) => j !== i))}>Retirer</button>}
                    </div>
                  ))}
                  {!lecture && refs.length < 20 && (
                    <button type="button" className="nje-btn nje-secondaire" onClick={() => setRefs((x) => [...x, { libelle: '', valeur: '' }])}>+ Ajouter une référence</button>
                  )}
                </section>
                {modifiable && (
                  <div className="nje-pied">
                    <span>{modifie ? 'Modifications non enregistrées' : 'Tout est enregistré'}</span>
                    <button type="submit" className="nje-btn nje-primaire" disabled={enCours || !modifie}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
                  </div>
                )}
              </form>
            )}

            {onglet === 'representant' && (
              <div id="pan-representant" role="tabpanel" aria-labelledby="tab-representant" className="nje-panneau">
                {rep && !nouveau && (
                  <form className="nje-carte" onSubmit={corrigerRepresentant}>
                    <div className="nje-titre-ligne">
                      <h2>Représentant légal en fonction</h2>
                      <span className="nje-pastille">Depuis le {dateFr(rep.debut)}</span>
                    </div>
                    <Grille defs={REPRESENTANT} valeurs={rep} onChange={(k, v) => setRep((x) => ({ ...x, [k]: v }))} lecture={lecture} />
                    <h3>Signature</h3>
                    <ImageChoix titre="Signature" image={rep.signature_url} alt="Signature du représentant légal" lecture={lecture} enCours={enCours}
                      options={{ maxL: 500, maxH: 200, maxCaracteres: 190 * 1024 }}
                      aide="Image de la signature, facultative. Enregistrez pour l'appliquer."
                      onChoisir={(v) => setRep((x) => ({ ...x, signature_url: v }))} onRetirer={() => setRep((x) => ({ ...x, signature_url: null }))} />
                    {modifiable && (
                      <div className="nje-actions-ligne nje-fin">
                        <button type="button" className="nje-btn nje-secondaire" onClick={() => setNouveau({ ...vide(REPRESENTANT), debut: aujourdhui(), signature_url: null })}>Changer de représentant légal…</button>
                        <button type="submit" className="nje-btn nje-primaire" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer les corrections'}</button>
                      </div>
                    )}
                    {modifiable && <p className="nje-note">« Enregistrer les corrections » met à jour la personne en fonction (coordonnées, faute de frappe) sans créer d'historique.</p>}
                  </form>
                )}

                {!rep && !nouveau && (
                  <section className="nje-carte">
                    <h2>Représentant légal</h2>
                    <p className="nje-vide">Aucun représentant légal n'est encore déclaré.</p>
                    {modifiable && <button type="button" className="nje-btn nje-primaire" onClick={() => setNouveau({ ...vide(REPRESENTANT), debut: aujourdhui(), signature_url: null })}>Déclarer le représentant légal</button>}
                  </section>
                )}

                {nouveau && (
                  <form className="nje-carte nje-encadre" onSubmit={changerRepresentant}>
                    <h2>{rep ? 'Nouveau représentant légal' : 'Déclarer le représentant légal'}</h2>
                    {rep && <p className="nje-note">{[rep.prenoms, rep.nom].filter(Boolean).join(' ')} sera conservé dans l'historique, en fonction jusqu'à la veille de la date ci-dessous. Les informations de l'entreprise ne changent pas.</p>}
                    <Grille defs={REPRESENTANT} valeurs={nouveau} onChange={(k, v) => setNouveau((x) => ({ ...x, [k]: v }))} lecture={false} />
                    <div className="nje-grille">
                      <div className="nje-champ">
                        <label htmlFor="rep-debut">Prise de fonction<span className="nje-requis" aria-hidden="true"> *</span></label>
                        <input id="rep-debut" type="date" required value={nouveau.debut} onChange={(e) => setNouveau((x) => ({ ...x, debut: e.target.value }))} />
                      </div>
                    </div>
                    <h3>Signature</h3>
                    <ImageChoix titre="Signature" image={nouveau.signature_url} alt="Signature" lecture={false} enCours={enCours}
                      options={{ maxL: 500, maxH: 200, maxCaracteres: 190 * 1024 }} aide="Facultative."
                      onChoisir={(v) => setNouveau((x) => ({ ...x, signature_url: v }))} onRetirer={() => setNouveau((x) => ({ ...x, signature_url: null }))} />
                    <div className="nje-actions-ligne nje-fin">
                      <button type="button" className="nje-btn nje-secondaire" onClick={() => setNouveau(null)} disabled={enCours}>Annuler</button>
                      <button type="submit" className="nje-btn nje-primaire" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
                    </div>
                  </form>
                )}

                {d.historique_representants.length > 0 && (
                  <section className="nje-carte">
                    <h2>Historique</h2>
                    <div className="nje-table-defil">
                      <table className="nje-table">
                        <thead><tr><th scope="col">Représentant</th><th scope="col">Fonction</th><th scope="col">Du</th><th scope="col">Au</th></tr></thead>
                        <tbody>
                          {d.historique_representants.map((h) => (
                            <tr key={h.id}>
                              <td>{[h.prenoms, h.nom].filter(Boolean).join(' ')}</td>
                              <td>{h.fonction || '—'}</td>
                              <td>{h.origine === 'migration' ? '—' : dateFr(h.debut)}</td>
                              <td>{dateFr(h.fin)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </main>
      {monCompte && <MonCompteModal onClose={() => setMonCompte(false)} />}
    </div>
  );
}
