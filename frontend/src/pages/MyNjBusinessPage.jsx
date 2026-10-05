import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import '@/styles/mynjbusiness.css';

// MyNjBusiness — « Où en est chaque prospect dans notre parcours commercial ? »
// Couche de suivi légère au-dessus des données existantes (prospects,
// démos, abonnements). Le serveur filtre le périmètre de chaque commercial.
const ETAPES = [
  { k: 'NOUVEAU',   label: 'Nouveau',     c: 'var(--st-nouveau)' },
  { k: 'CONTACTE',  label: 'Contacté',    c: 'var(--st-contacte)' },
  { k: 'INTERESSE', label: 'Intéressé',   c: 'var(--st-interesse)' },
  { k: 'DEMO',      label: 'Démo / essai', c: 'var(--st-demo)' },
  { k: 'ADHERENT',  label: 'Adhérent',    c: 'var(--st-adherent)' },
  { k: 'ACTIF',     label: 'Actif',       c: 'var(--st-actif)' },
];
const PERDU = { k: 'PERDU', label: 'Perdu', c: '#94a3b8' };
const etapeDe = (k) => ETAPES.find((e) => e.k === k) || PERDU;
const FILTRES = [
  ['', 'Tous'], ['NOUVEAU', 'Nouveaux'], ['CONTACTE', 'Contactés'], ['INTERESSE', 'Intéressés'], ['DEMO', 'Démo / essai'],
  ['ADHERENT', 'Adhérents'], ['ACTIF', 'Actifs'], ['relance', 'À relancer'], ['PERDU', 'Perdus'],
];
const STATUT_DETAIL = {
  INVITATION_ENVOYEE: 'Accès envoyé', DEMO_ACTIVE: 'Démo en cours', DEMO_EXPIREE: 'Démo expirée',
  PAIEMENT_EN_ATTENTE: 'Paiement en attente', DEMO_ANNULEE: 'Démo annulée', PROSPECT_ABANDONNE: 'Abandonné',
};
const ACTIONS_HIST = {
  CREATION: 'Prospect créé', DEMANDE_WEB: 'Demande reçue (site web)', NOUVELLE_DEMANDE_WEB: 'Nouvelle demande (site web)',
  APPEL: 'Appel effectué', WHATSAPP: 'Message WhatsApp', NOTE: 'Note', RELANCE_PROGRAMMEE: 'Relance programmée',
  RELANCE_TERMINEE: 'Relance faite', CHANGEMENT_STATUT: 'Changement d\'étape', ATTRIBUTION: 'Commercial attribué',
  INVITATION_CREEE: 'Accès démo envoyé', INVITATION_RENVOYEE: 'Accès démo renvoyé', ACTIVATION: 'Démo activée',
  EXPIRATION_AUTOMATIQUE: 'Démo expirée', PROLONGATION: 'Démo prolongée', PAIEMENT_ENREGISTRE: 'Paiement enregistré',
  PAIEMENT_RECU: 'Paiement reçu', CONVERSION: 'Devenu client', MODIFICATION: 'Fiche modifiée',
  EMAIL_ENVOYE: 'E-mail envoyé', EMAIL_RENVOYE: 'E-mail renvoyé', EMAIL_NON_ENVOYE: 'E-mail non envoyé',
};

const jour = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '');
const jourLong = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—');
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const dansJours = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
// Numéro international pour WhatsApp (Cameroun par défaut : 9 chiffres → 237…).
const numeroWa = (tel) => {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9) d = `237${d}`;
  return d;
};

const Ic = {
  phone: <svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>,
  user: <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  clock: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  flag: <svg viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>,
  search: <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
};

// ── Carte prospect ─────────────────────────────────────────────────────────
function Carte({ c, sel, onOpen, direction }) {
  const e = etapeDe(c.etape);
  const retard = c.prochaine_action_le && c.prochaine_action_le.slice(0, 10) < aujourdhui();
  return (
    <button className={`mnb-card${sel ? ' sel' : ''}`} style={{ '--c': e.c }} onClick={() => onOpen(c.id)}>
      <div className="t">{c.entreprise || c.nom_complet}</div>
      <div className="s">{[c.entreprise && c.nom_complet, c.secteur].filter(Boolean).join(' · ') || ' '}</div>
      <div className="m">
        {c.telephone && <span>{Ic.phone}{c.telephone}</span>}
        {direction && <span>{Ic.user}{c.commercial_nom || <i style={{ color: 'var(--text-light)' }}>Non attribué</i>}</span>}
        {c.dernier_contact_le && <span>{Ic.clock}Contact {jour(c.dernier_contact_le)}</span>}
        {c.prochaine_action && (
          <span style={retard ? { color: 'var(--st-relance)', fontWeight: 600 } : undefined}>
            {Ic.flag}{c.prochaine_action}{c.prochaine_action_le ? ` · ${jour(c.prochaine_action_le)}` : ''}
          </span>
        )}
        {c.etape === 'ACTIF' && c.abonnement_fin && <span>{Ic.clock}{c.forfait_nom} · fin {new Date(c.abonnement_fin).toLocaleDateString('fr-FR')}</span>}
      </div>
      <div className="f">
        <span className="mnb-pill" style={{ '--c': e.c }}>{STATUT_DETAIL[c.statut] || e.label}</span>
        {c.a_relancer && <span className="mnb-pill relance">À relancer</span>}
        {c.demande_web && <span className="mnb-pill neutre nodot">🌐 Site web</span>}
      </div>
    </button>
  );
}

// ── Nouveau prospect (rapide) ──────────────────────────────────────────────
function NouveauProspect({ data, onClose, onCree }) {
  const toast = useToast();
  const [f, setF] = useState({ entreprise: '', nom_complet: '', telephone: '', email: '', secteur: '', source: 'Terrain', commercial_id: '', action: 'Appeler', le: aujourdhui() });
  const [err, setErr] = useState('');
  const [doublon, setDoublon] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const enregistrer = async () => {
    setErr(''); setDoublon(null);
    if (!f.entreprise.trim() && !f.nom_complet.trim()) { setErr('Entreprise ou nom du contact.'); return; }
    if (!f.telephone.trim() && !f.email.trim()) { setErr('Téléphone ou e-mail.'); return; }
    const r = await api.post('/prospects', { entreprise: f.entreprise, nom_complet: f.nom_complet, telephone: f.telephone, email: f.email,
      secteur: f.secteur, source: f.source, commercial_id: f.commercial_id || undefined });
    if (r.error) { setErr(r.error); if (r.existing_id) setDoublon(r.existing_id); return; }
    if (f.action) await api.post(`/pipeline/${r.id}/action`, { type: 'relance', prochaine_action: f.action, prochaine_action_le: f.le || null });
    toast('Prospect ajouté.', 'success');
    onCree(r.id);
  };
  return (
    <>
      <div className="mnb-scrim" onClick={onClose} />
      <aside className="mnb-sheet" role="dialog" aria-label="Nouveau prospect">
        <div className="mnb-grip" />
        <div className="mnb-sheet-h"><div className="t">Nouveau prospect</div><button className="x" onClick={onClose} aria-label="Fermer">✕</button></div>
        <div className="mnb-sheet-b">
          {err && <div className="alert-err" style={{ marginBottom: 10 }}>{err}
            {doublon && <button className="mnb-btn" style={{ marginLeft: 8 }} onClick={() => onCree(doublon)}>Ouvrir la fiche existante</button>}</div>}
          <div className="mnb-form">
            <input placeholder="Entreprise" value={f.entreprise} onChange={set('entreprise')} autoFocus />
            <input placeholder="Nom du contact" value={f.nom_complet} onChange={set('nom_complet')} />
            <div className="row">
              <input placeholder="Téléphone" type="tel" value={f.telephone} onChange={set('telephone')} />
              <input placeholder="E-mail (facultatif)" type="email" value={f.email} onChange={set('email')} />
            </div>
            <input placeholder="Secteur (commerce, pharmacie…)" value={f.secteur} onChange={set('secteur')} />
            <div className="mnb-sec" style={{ margin: '6px 0 0' }}>Source</div>
            <div className="mnb-chips">
              {(data?.sources || []).filter((s) => s !== 'Formulaire web').map((s) => (
                <button key={s} className={`mnb-chip${f.source === s ? ' on' : ''}`} onClick={() => setF((x) => ({ ...x, source: s }))}>{s}</button>
              ))}
            </div>
            {data?.direction && (
              <select value={f.commercial_id} onChange={set('commercial_id')}>
                <option value="">— Commercial responsable —</option>
                {(data.commerciaux || []).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            )}
            <div className="mnb-sec" style={{ margin: '6px 0 0' }}>Prochaine action</div>
            <div className="row">
              <select value={f.action} onChange={set('action')}>
                <option value="">Aucune</option>
                {(data?.actions || []).map((a) => <option key={a}>{a}</option>)}
              </select>
              <input type="date" value={f.le} onChange={set('le')} />
            </div>
          </div>
          <button className="mnb-btn primary" style={{ width: '100%', justifyContent: 'center', padding: 12 }} onClick={enregistrer}>Ajouter le prospect</button>
        </div>
      </aside>
    </>
  );
}

// ── Fiche (panneau latéral / bottom sheet) ─────────────────────────────────
function Fiche({ id, data, onClose, onChange }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [p, setP] = useState(null);
  const [mode, setMode] = useState(null); // 'note' | 'relance' | 'email'
  const [note, setNote] = useState('');
  const [relance, setRelance] = useState({ action: 'Relancer', le: dansJours(2) });
  const [email, setEmail] = useState('');
  const [lien, setLien] = useState(null);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    const r = await api.get(`/pipeline/${id}`);
    if (r.error) { toast(r.error, 'error'); onClose(); return; }
    setP(r);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setP(null); setMode(null); setLien(null); charger(); }, [charger]);

  const agir = async (corps, msg) => {
    setOccupe(true);
    const r = await api.post(`/pipeline/${id}/action`, corps);
    setOccupe(false);
    if (r.error) { toast(r.error, 'error'); return false; }
    if (msg) toast(msg, 'success');
    setMode(null); setNote('');
    await charger(); onChange();
    return true;
  };
  const appeler = () => { window.location.href = `tel:${p.telephone}`; agir({ type: 'appel' }, 'Appel noté. Ajoutez une note si besoin.'); };
  const whatsapp = () => {
    const texte = encodeURIComponent(`Bonjour ${p.nom_complet || ''}, `);
    window.open(`https://wa.me/${numeroWa(p.telephone)}?text=${texte}`, '_blank', 'noopener');
    agir({ type: 'whatsapp' }, 'Message WhatsApp noté.');
  };
  const envoyerDemo = async () => {
    if (!p.email) { setMode('email'); return; }
    if (!window.confirm(`Créer l'espace de démonstration et envoyer l'accès à ${p.email} ?`)) return;
    setOccupe(true);
    const r = await api.post(`/prospects/${id}/invitation`);
    setOccupe(false);
    if (r.error) { toast(r.error, 'error'); return; }
    if (r.lien) setLien(r.lien);
    toast(r.lien ? 'Démo créée : e-mail non parti, transmettez le lien.' : 'Accès de démonstration envoyé.', 'success');
    await charger(); onChange();
  };
  const enregistrerEmail = async () => {
    const r = await api.put(`/prospects/${id}`, { email });
    if (r.error) { toast(r.error, 'error'); return; }
    setMode(null); await charger(); onChange();
  };

  if (!p) {
    return (<><div className="mnb-scrim" onClick={onClose} />
      <aside className="mnb-sheet"><div className="mnb-sheet-b"><div className="loading-msg">Chargement…</div></div></aside></>);
  }
  const e = etapeDe(p.etape);
  const ferme = p.etape === 'PERDU';
  const suivant = {
    NOUVEAU:   { label: 'Passer à « Contacté »', sub: 'Premier échange effectué', run: () => agir({ type: 'suivant' }, 'Étape : Contacté') },
    CONTACTE:  { label: 'Passer à « Intéressé »', sub: 'Le prospect veut en savoir plus', run: () => agir({ type: 'suivant' }, 'Étape : Intéressé') },
    INTERESSE: { label: 'Envoyer la démonstration', sub: 'Espace d\'essai + lien d\'activation', run: envoyerDemo },
    DEMO:      { label: p.statut === 'DEMO_EXPIREE' ? 'Prolonger ou enregistrer le paiement' : 'Enregistrer l\'adhésion (paiement)', sub: 'Fiche complète → Paiements', run: () => navigate(`/prospects?id=${id}`) },
    ADHERENT:  { label: data?.direction ? 'Finaliser : convertir en client' : 'Paiement en cours de validation', sub: data?.direction ? 'Fiche complète → Convertir' : 'La Direction finalise l\'adhésion', run: data?.direction ? () => navigate(`/prospects?id=${id}`) : null },
    ACTIF:     { label: p.abonnement_fin ? `Abonnement ${p.forfait_nom} · fin ${jourLong(p.abonnement_fin)}` : 'Client actif', sub: 'Suivi de l\'abonnement', run: null },
  }[p.etape];

  return (
    <>
      <div className="mnb-scrim" onClick={onClose} />
      <aside className="mnb-sheet" role="dialog" aria-label={`Fiche ${p.entreprise || p.nom_complet}`}>
        <div className="mnb-grip" />
        <div className="mnb-sheet-h">
          <div>
            <div className="t">{p.entreprise || p.nom_complet}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <span className="mnb-pill" style={{ '--c': e.c }}>{STATUT_DETAIL[p.statut] || e.label}</span>
              {p.a_relancer && <span className="mnb-pill relance">À relancer</span>}
            </div>
          </div>
          <button className="x" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="mnb-sheet-b">
          {!ferme && (
            <div className="mnb-quick">
              <button className="mnb-btn" disabled={!p.telephone || occupe} onClick={appeler}><span className="ic">📞</span>Appeler</button>
              <button className="mnb-btn wa" disabled={!p.telephone || occupe} onClick={whatsapp}><span className="ic">💬</span>WhatsApp</button>
              <button className="mnb-btn" onClick={() => setMode(mode === 'note' ? null : 'note')}><span className="ic">📝</span>Note</button>
              <button className="mnb-btn" onClick={() => setMode(mode === 'relance' ? null : 'relance')}><span className="ic">⏰</span>Relance</button>
              <button className="mnb-btn" onClick={() => navigate(`/prospects?id=${id}`)}><span className="ic">📂</span>Fiche complète</button>
              {p.prochaine_action && <button className="mnb-btn" disabled={occupe} onClick={() => agir({ type: 'relance', prochaine_action: '', prochaine_action_le: null }, 'Relance marquée comme faite.')}><span className="ic">✅</span>Relance faite</button>}
            </div>
          )}

          {mode === 'note' && (
            <div className="mnb-form">
              <textarea rows={3} placeholder="Ex. : intéressé par le module Caisse, rappeler après le 15." value={note} onChange={(ev) => setNote(ev.target.value)} autoFocus />
              <button className="mnb-btn primary" disabled={!note.trim() || occupe} onClick={() => agir({ type: 'note', note }, 'Note ajoutée.')}>Ajouter la note</button>
            </div>
          )}
          {mode === 'relance' && (
            <div className="mnb-form">
              <div className="mnb-chips">
                {(data?.actions || []).map((a) => <button key={a} className={`mnb-chip${relance.action === a ? ' on' : ''}`} onClick={() => setRelance((x) => ({ ...x, action: a }))}>{a}</button>)}
              </div>
              <div className="mnb-chips">
                {[['Aujourd\'hui', 0], ['Demain', 1], ['Dans 3 j', 3], ['Dans 1 sem.', 7]].map(([l, n]) => (
                  <button key={l} className={`mnb-chip${relance.le === dansJours(n) ? ' on' : ''}`} onClick={() => setRelance((x) => ({ ...x, le: dansJours(n) }))}>{l}</button>
                ))}
              </div>
              <input type="date" value={relance.le} onChange={(ev) => setRelance((x) => ({ ...x, le: ev.target.value }))} />
              <button className="mnb-btn primary" disabled={occupe} onClick={() => agir({ type: 'relance', prochaine_action: relance.action, prochaine_action_le: relance.le || null }, 'Relance programmée.')}>Programmer</button>
            </div>
          )}
          {mode === 'email' && (
            <div className="mnb-form">
              <div style={{ fontSize: 13 }}>L'e-mail sert d'identifiant de connexion à la démo.</div>
              <input type="email" placeholder="adresse@entreprise.cm" value={email} onChange={(ev) => setEmail(ev.target.value)} autoFocus />
              <button className="mnb-btn primary" onClick={enregistrerEmail}>Enregistrer puis envoyer la démo</button>
            </div>
          )}
          {lien && (
            <div className="mnb-form">
              <div style={{ fontSize: 13 }}>E-mail non envoyé : transmettez ce lien <b>au prospect uniquement</b> (affiché une seule fois).</div>
              <input readOnly value={lien} onFocus={(ev) => ev.target.select()} />
              <button className="mnb-btn" onClick={() => navigator.clipboard?.writeText(lien).then(() => toast('Lien copié.', 'success'))}>Copier le lien</button>
            </div>
          )}

          {suivant && (
            <button className="mnb-next" disabled={!suivant.run || occupe} onClick={suivant.run || undefined} style={!suivant.run ? { cursor: 'default', background: '#f1f5f9', color: 'var(--text)' } : undefined}>
              <span><b>{suivant.label}</b><small>{suivant.sub}</small></span>{suivant.run && <span>→</span>}
            </button>
          )}

          <div className="mnb-fields">
            <div className="mnb-field"><div className="k">Contact</div><div className="v">{p.nom_complet || '—'}</div></div>
            <div className="mnb-field"><div className="k">Secteur</div><div className="v">{p.secteur || '—'}</div></div>
            <div className="mnb-field"><div className="k">Téléphone</div><div className="v">{p.telephone ? <a href={`tel:${p.telephone}`}>{p.telephone}</a> : '—'}</div></div>
            <div className="mnb-field"><div className="k">E-mail</div><div className="v">{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : '—'}</div></div>
            <div className="mnb-field"><div className="k">Commercial</div><div className="v">
              {data?.direction ? (
                <select className="mnb-select" style={{ width: '100%' }} value={p.commercial_id || ''} onChange={(ev) => agir({ type: 'attribuer', commercial_id: ev.target.value || null }, 'Commercial attribué.')}>
                  <option value="">Non attribué</option>
                  {(data.commerciaux || []).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              ) : (p.commercial_nom || '—')}
            </div></div>
            <div className="mnb-field"><div className="k">Source</div><div className="v">{p.source || '—'}</div></div>
            <div className="mnb-field"><div className="k">Dernier contact</div><div className="v">{jourLong(p.dernier_contact_le)}</div></div>
            <div className="mnb-field"><div className="k">Prochaine action</div><div className="v" style={p.a_relancer && p.prochaine_action ? { color: 'var(--st-relance)', fontWeight: 600 } : undefined}>
              {p.prochaine_action ? `${p.prochaine_action}${p.prochaine_action_le ? ` le ${jour(p.prochaine_action_le)}` : ''}` : '—'}</div></div>
            {(p.etape === 'DEMO' || p.demo_fin) && p.etape !== 'ACTIF' && p.tenant_id && (
              <div className="mnb-field full"><div className="k">Démonstration</div><div className="v">Jusqu'au {jourLong(p.demo_fin)}</div></div>
            )}
            {p.client && <div className="mnb-field full"><div className="k">Espace client</div><div className="v">✓ {p.client.nom}{p.forfait_nom ? ` · ${p.forfait_nom}` : ''}</div></div>}
          </div>

          <div className="mnb-sec">Historique</div>
          <ul className="mnb-tl">
            {p.historique.map((h) => (
              <li key={h.id}>
                <div className="d">{new Date(h.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{h.auteur ? ` · ${h.auteur}` : ''}</div>
                <div>{ACTIONS_HIST[h.action] || h.action}{h.action === 'RELANCE_PROGRAMMEE' && h.details?.prochaine_action ? ` : ${h.details.prochaine_action}${h.details.le ? ` le ${jour(h.details.le)}` : ''}` : ''}</div>
                {h.motif && <div className="q">« {h.motif} »</div>}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function MyNjBusinessPage() {
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');
  const [recherche, setRecherche] = useState('');
  const [q, setQ] = useState('');
  const [filtre, setFiltre] = useState('');
  const [commercial, setCommercial] = useState('');
  const [sel, setSel] = useState(null);
  const [nouveau, setNouveau] = useState(false);
  const [ongletMobile, setOngletMobile] = useState('NOUVEAU');
  const premier = useRef(true);

  const charger = useCallback(async () => {
    const p = new URLSearchParams({ recherche: q, filtre, commercial });
    const r = await api.get(`/pipeline?${p}`);
    if (r.error) { setErreur(r.error); return; }
    setErreur(''); setData(r);
    // Mobile : ouvrir d'emblée l'onglet le plus utile (relances, sinon 1re étape non vide).
    if (premier.current) {
      premier.current = false;
      const k = ETAPES.find((e) => r.colonnes[e.k]?.cartes.some((c) => c.a_relancer))?.k
        || ETAPES.find((e) => r.colonnes[e.k]?.total)?.k || 'NOUVEAU';
      setOngletMobile(k);
    }
  }, [q, filtre, commercial]);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { const t = setTimeout(() => setQ(recherche.trim()), 300); return () => clearTimeout(t); }, [recherche]);

  const colonnes = useMemo(() => {
    if (!data) return [];
    if (filtre === 'PERDU') return [PERDU];
    if (ETAPES.some((e) => e.k === filtre)) return ETAPES.filter((e) => e.k === filtre);
    return ETAPES;
  }, [data, filtre]);
  useEffect(() => { if (colonnes.length === 1) setOngletMobile(colonnes[0].k); }, [colonnes]);

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!data) return <div className="loading-msg">Chargement…</div>;

  const K = data.kpis;
  const kpis = [
    ['', 'Prospects', K.prospects, 'var(--brand)'],
    ['relance', 'À relancer', K.a_relancer, 'var(--st-relance)'],
    ['DEMO', 'Démos / essais', K.demos, 'var(--st-demo)'],
    ['ADHERENT', 'Adhérents', K.adherents, 'var(--st-adherent)'],
    ['ACTIF', 'Clients actifs', K.actifs, 'var(--st-actif)'],
  ];
  const maxF = Math.max(1, ...(data.entonnoir || []).map((x) => x.n));

  return (
    <div className="mnb">
      <div className="mnb-head">
        <div className="mnb-title">MyNjBusiness<small>{data.direction ? 'Prospects & clients du cabinet' : 'Mes prospects & clients'}</small></div>
        <button className="mnb-btn primary" onClick={() => setNouveau(true)}>＋ Prospect</button>
      </div>

      <div className="mnb-kpis">
        {kpis.map(([f, l, v, c]) => (
          <button key={l} className={`mnb-kpi${filtre === f && (f || !filtre) ? ' on' : ''}`} style={{ '--k': c }} onClick={() => setFiltre(filtre === f ? '' : f)}>
            <div className="lbl">{l}</div><div className="val">{v}</div>
          </button>
        ))}
      </div>

      {(data.aujourdhui > 0 || data.en_retard > 0) && (
        <div className="mnb-today">
          <span>⏰</span>
          <span><b>{data.aujourdhui}</b> action{data.aujourdhui > 1 ? 's' : ''} à faire aujourd'hui
            {data.en_retard > 0 && <> · <b>{data.en_retard}</b> en retard</>}</span>
          <button className="mnb-btn" onClick={() => setFiltre('relance')}>Voir</button>
        </div>
      )}

      <div className="mnb-bar">
        <label className="mnb-search">{Ic.search}
          <input type="search" placeholder="Entreprise, nom, téléphone, e-mail…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </label>
        <select className="mnb-select" value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label="Filtre">
          {FILTRES.map(([k, l]) => <option key={k} value={k}>{l}{k === 'PERDU' ? ` (${data.perdus})` : ''}</option>)}
        </select>
        {data.direction && (
          <select className="mnb-select" value={commercial} onChange={(e) => setCommercial(e.target.value)} aria-label="Commercial">
            <option value="">Tous les commerciaux</option>
            {data.commerciaux.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            <option value="aucun">Non attribués</option>
          </select>
        )}
      </div>

      {colonnes.length > 1 && (
        <div className="mnb-tabs" role="tablist">
          {colonnes.map((e) => (
            <button key={e.k} role="tab" aria-selected={ongletMobile === e.k} className={`mnb-tab${ongletMobile === e.k ? ' on' : ''}`} style={{ '--c': e.c }} onClick={() => setOngletMobile(e.k)}>
              {e.label}<span className="n">{data.colonnes[e.k].total}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mnb-board" style={colonnes.length === 1 ? { gridTemplateColumns: 'minmax(260px, 520px)' } : undefined}>
        {colonnes.map((e) => {
          const col = data.colonnes[e.k];
          return (
            <section key={e.k} className={`mnb-col${ongletMobile === e.k || colonnes.length === 1 ? ' mobile-on' : ''}`} style={{ '--c': e.c }}>
              <div className="mnb-col-h"><span className="dot" />{e.label}<span className="n">{col.total}</span></div>
              <div className="mnb-cards">
                {col.cartes.length === 0 && <div className="mnb-empty">{filtre === 'relance' ? 'Rien à relancer' : 'Aucun prospect'}</div>}
                {col.cartes.map((c) => <Carte key={c.id} c={c} sel={sel === c.id} onOpen={setSel} direction={data.direction} />)}
                {col.total > col.cartes.length && <div className="mnb-empty">+ {col.total - col.cartes.length} autres : affinez la recherche</div>}
              </div>
            </section>
          );
        })}
      </div>

      {data.direction && (
        <div className="mnb-dir">
          <div className="mnb-panel">
            <h3>Parcours de conversion <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: 'var(--text-muted)' }}>· étape atteinte</span></h3>
            <div className="mnb-funnel">
              {data.entonnoir.map((x, i) => (
                <div className="row" key={x.etape}>
                  <span>{x.etape}</span>
                  <span className="bar"><i style={{ width: `${(x.n / maxF) * 100}%`, opacity: 1 - i * 0.12 }} /></span>
                  <span className="v">{x.n}{i > 0 && data.entonnoir[0].n > 0 && <small>{Math.round((x.n / data.entonnoir[0].n) * 100)} %</small>}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mnb-panel">
            <h3>Par commercial</h3>
            <table className="mnb-table">
              <thead><tr><th>Commercial</th><th>Prospects</th><th>Convertis</th><th>À relancer</th></tr></thead>
              <tbody>
                {data.par_commercial.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--text-light)' }}>Aucun prospect.</td></tr>}
                {data.par_commercial.map((c) => (
                  <tr key={c.commercial_id || 'aucun'} style={{ cursor: 'pointer' }} onClick={() => setCommercial(c.commercial_id || 'aucun')}>
                    <td>{c.nom}</td><td>{c.prospects}</td><td>{c.convertis}</td>
                    <td style={c.a_relancer ? { color: 'var(--st-relance)', fontWeight: 700 } : undefined}>{c.a_relancer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sel && <Fiche id={sel} data={data} onClose={() => setSel(null)} onChange={charger} />}
      {nouveau && <NouveauProspect data={data} onClose={() => setNouveau(false)} onCree={(id) => { setNouveau(false); charger(); setSel(id); }} />}
    </div>
  );
}
