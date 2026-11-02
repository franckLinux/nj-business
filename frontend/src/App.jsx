import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import Layout from '@/components/Layout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import JournalPage from '@/pages/JournalPage';
import AttentePage from '@/pages/AttentePage';
import JournauxRecapPage from '@/pages/JournauxRecapPage';
import BudgetPage from '@/pages/BudgetPage';
import PrevisionsPage from '@/pages/PrevisionsPage';
import AppelFondsPage from '@/pages/AppelFondsPage';
import SuiviActivitesPage from '@/pages/SuiviActivitesPage';
import CompteEmploiPage from '@/pages/CompteEmploiPage';
import ConfigPage from '@/pages/ConfigPage';
import PasserelleTab from '@/components/config/PasserelleTab';
import ControlePage from '@/pages/ControlePage';
import RegistreTiersPage from '@/pages/RegistreTiersPage';
import ArretsInventairesPage from '@/pages/ArretsInventairesPage';
import TenantsPage from '@/pages/TenantsPage';
import PermissionsPage from '@/pages/PermissionsPage';
import PlanModelePage from '@/pages/PlanModelePage';
import ValidationDirectePage from '@/pages/ValidationDirectePage';
import PlateformePage from '@/pages/PlateformePage';
import ProspectsPage from '@/pages/ProspectsPage';
import MyNjBusinessPage from '@/pages/MyNjBusinessPage';
import ActivationPage from '@/pages/ActivationPage';
import DemandeDemoPage from '@/pages/DemandeDemoPage';
import ReinitialisationPage from '@/pages/ReinitialisationPage';
import PwaBootstrap from '@/components/PwaBootstrap';
import OfflineIndicator from '@/components/OfflineIndicator';
import { PAGE_PERMS, peut, peutGererProspects, voitConfiguration } from '@/lib/acces';
import AccueilPage from '@/pages/AccueilPage';
import CommercialLayout, { peutUn, DROITS_DEMANDES, DROITS_AUTORISATIONS, DROITS_BONS, DROITS_HISTORIQUE } from '@/components/commercial/CommercialLayout';
import DemandesPage from '@/pages/commercial/DemandesPage';
import DemandeFormPage from '@/pages/commercial/DemandeFormPage';
import DemandePage from '@/pages/commercial/DemandePage';
import DemarragePage from '@/pages/commercial/DemarragePage';
import AgencesPage from '@/pages/commercial/AgencesPage';
import UnitesPage from '@/pages/commercial/UnitesPage';
import SocietePage from '@/pages/commercial/SocietePage';
import MagasinsPage from '@/pages/commercial/MagasinsPage';
import FamillesPage from '@/pages/commercial/FamillesPage';
import ArticlesPage from '@/pages/commercial/ArticlesPage';
import TiersPage from '@/pages/commercial/TiersPage';
import TaxesPage from '@/pages/commercial/TaxesPage';
import UtilisateursPage from '@/pages/commercial/UtilisateursPage';
import BonsPage from '@/pages/commercial/BonsPage';
import BonFormPage from '@/pages/commercial/BonFormPage';
import BonPage from '@/pages/commercial/BonPage';
import TableauBordPage from '@/pages/commercial/TableauBordPage';
import DocumentsPage from '@/pages/commercial/DocumentsPage';
import HistoriquePage from '@/pages/commercial/HistoriquePage';
import StockEtatPage from '@/pages/commercial/StockEtatPage';
import StockDocsPage from '@/pages/commercial/StockDocsPage';
import StockDocFormPage from '@/pages/commercial/StockDocFormPage';
import StockDocPage from '@/pages/commercial/StockDocPage';
import { StockMouvementsPage, StockValorisationPage } from '@/pages/commercial/StockMouvementsPage';
import { DROITS_STOCK, DROITS_SAISIE } from '@/components/commercial/stock';
import VerificationBcPage from '@/pages/VerificationBcPage';
import { consommerEntree, moduleActif, routeApresConnexion, systemeInstalle, utiliseAccueil } from '@/lib/modules';

// Toutes les pages listées dans MIGRATION.md sont désormais portées.
export default function App() {
  const { isAuthenticated } = useApp();
  // Lien d'activation d'une démo : page publique, prioritaire sur la session.
  const activation = window.location.pathname.match(/^\/activation\/([A-Za-z0-9_-]+)\/?$/);
  if (activation) return <ActivationPage token={activation[1]} />;
  // Page publique de demande de démonstration (lien à diffuser).
  if (/^\/demande-demo\/?$/.test(window.location.pathname)) return <DemandeDemoPage />;
  // Lien « mot de passe oublié » reçu par e-mail (C9).
  const reinit = window.location.pathname.match(/^\/reinitialisation\/([A-Za-z0-9_-]+)\/?$/);
  if (reinit) return <ReinitialisationPage token={reinit[1]} />;
  // QR code d'un bon de commande : vérification publique, sans session.
  const verif = window.location.pathname.match(/^\/verifier\/([A-Za-z0-9_-]+)\/?$/);
  if (verif) return <VerificationBcPage jeton={verif[1]} />;

  return (
    <>
      <PwaBootstrap />
      <OfflineIndicator />
      {isAuthenticated ? <AuthenticatedApp /> : <LoginPage />}
    </>
  );
}

// Garde de route : une URL tapée ou un ancien favori vers un écran non
// autorisé ramène au tableau de bord au lieu d'afficher une erreur 403.
// Tant que la liste des permissions n'est pas chargée, on n'affiche rien.
function Autorise({ code, ok, children }) {
  const { user, can } = useApp();
  if (user && user.role !== 'super_admin' && user.permissions === undefined) return null;
  const permis = ok !== undefined ? ok : peut(can, code);
  return permis ? children : <Navigate to="/" replace />;
}

// NJ BUSINESS (048) — garde côté interface du module NJ CAISSE PRO.
// Un utilisateur de client dont la caisse n'est pas activée est ramené à
// l'accueil (le serveur refuse de toute façon : 403 MODULE_INACTIF).
// Système de modules absent côté serveur : aucun effet (comportement d'avant).
function GardeCaisse({ children }) {
  const { user } = useApp();
  if (utiliseAccueil(user) && systemeInstalle(user) && !moduleActif(user, 'caisse')) {
    return <Navigate to="/accueil" replace />;
  }
  return children;
}

// NJ COMMERCIAL (050) — même principe que GardeCaisse ; le cabinet passe (le
// serveur répond 403 MODULE_INACTIF si le module n'est pas activé chez le client).
function GardeCommercial({ children }) {
  const { user } = useApp();
  if (utiliseAccueil(user) && systemeInstalle(user) && !moduleActif(user, 'commercial')) {
    return <Navigate to="/accueil" replace />;
  }
  return children;
}

// Entrée du module (lot 1) : le tableau de bord pour qui le voit, sinon ses
// expressions de besoin, sinon la mise en route du paramétrage.
function EntreeCommercial() {
  const { user, can } = useApp();
  if (user && user.role !== 'super_admin' && user.permissions === undefined) return null;
  if (can('com.tableau_bord.voir')) return <Navigate to="/commercial/tableau-bord" replace />;
  if (can('com.da.creer') || can('com.da.voir_tout')) return <Navigate to="/commercial/demandes" replace />;
  if (can('com.stock.voir')) return <Navigate to="/commercial/stock" replace />;
  if (can('com.stock.valider')) return <Navigate to="/commercial/stock/validation" replace />;
  const saisie = [['com.stock.entree', 'entrees'], ['com.stock.sortie', 'sorties'], ['com.stock.transfert', 'transferts'], ['com.stock.inventaire', 'inventaires']].find(([c]) => can(c));
  if (saisie) return <Navigate to={`/commercial/stock/${saisie[1]}`} replace />;
  if (can('com.stock.journal')) return <Navigate to="/commercial/stock/mouvements" replace />;
  if (can('com.stock.valorisation')) return <Navigate to="/commercial/stock/valorisation" replace />;
  return <Navigate to="/commercial/mise-en-route" replace />;
}

// Garde d'un écran du module : une permission parmi plusieurs suffit.
function AutoriseCm({ codes, children }) {
  const { user, can } = useApp();
  if (user && user.role !== 'super_admin' && user.permissions === undefined) return null;
  return peutUn(can, codes) ? children : <Navigate to="/commercial" replace />;
}

function AuthenticatedApp() {
  const { user, can, activeTenantId } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  // Juste après la connexion (une seule fois) : un module → entrée directe
  // (comportement actuel) ; plusieurs ou aucun → accueil NJ BUSINESS (D1).
  useEffect(() => {
    if (!consommerEntree()) return;
    const dest = routeApresConnexion(user);
    if (dest && dest !== location.pathname) navigate(dest, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Module désactivé pendant la session : retour à l'accueil avec un message.
  useEffect(() => {
    const surModuleInactif = () => {
      if (utiliseAccueil(user)) navigate('/accueil', { replace: true, state: { raison: 'module-inactif' } });
    };
    window.addEventListener('module-inactif', surModuleInactif);
    return () => window.removeEventListener('module-inactif', surModuleInactif);
  }, [user, navigate]);

  return (
    <Routes>
      {/* Accueil NJ BUSINESS : hors du menu de la caisse, réservé aux utilisateurs d'un client. */}
      <Route path="accueil" element={utiliseAccueil(user) ? <AccueilPage /> : <Navigate to="/" replace />} />
      <Route path="commercial" element={<GardeCommercial><CommercialLayout /></GardeCommercial>}>
        <Route index element={<EntreeCommercial />} />
        <Route path="mise-en-route" element={<DemarragePage />} />
        <Route path="agences"      element={<AutoriseCm codes={['com.parametrage.voir']}><AgencesPage /></AutoriseCm>} />
        <Route path="unites"       element={<AutoriseCm codes={['com.parametrage.voir', 'com.articles.voir']}><UnitesPage /></AutoriseCm>} />
        <Route path="societe"      element={<AutoriseCm codes={['com.parametrage.voir']}><SocietePage /></AutoriseCm>} />
        <Route path="magasins"     element={<AutoriseCm codes={['com.parametrage.voir', 'com.articles.voir']}><MagasinsPage /></AutoriseCm>} />
        <Route path="familles"     element={<AutoriseCm codes={['com.parametrage.voir', 'com.articles.voir']}><FamillesPage /></AutoriseCm>} />
        <Route path="articles"     element={<AutoriseCm codes={['com.articles.voir', 'com.da.creer']}><ArticlesPage /></AutoriseCm>} />
        <Route path="fournisseurs" element={<AutoriseCm codes={['com.tiers.voir']}><TiersPage key="f" type="fournisseur" /></AutoriseCm>} />
        <Route path="clients"      element={<AutoriseCm codes={['com.tiers.voir']}><TiersPage key="c" type="client" /></AutoriseCm>} />
        <Route path="taxes"        element={<AutoriseCm codes={['com.parametrage.voir']}><TaxesPage /></AutoriseCm>} />
        <Route path="utilisateurs" element={<AutoriseCm codes={['com.parametrage.modifier']}><UtilisateursPage /></AutoriseCm>} />
        <Route path="demandes"              element={<AutoriseCm codes={DROITS_DEMANDES}><DemandesPage key="d" /></AutoriseCm>} />
        <Route path="demandes/nouvelle"     element={<AutoriseCm codes={['com.da.creer']}><DemandeFormPage key="n" /></AutoriseCm>} />
        <Route path="demandes/:id"          element={<AutoriseCm codes={DROITS_DEMANDES}><DemandePage /></AutoriseCm>} />
        <Route path="demandes/:id/modifier" element={<AutoriseCm codes={['com.da.creer']}><DemandeFormPage key="m" /></AutoriseCm>} />
        <Route path="autorisations"         element={<AutoriseCm codes={DROITS_AUTORISATIONS}><DemandesPage key="a" autorisations /></AutoriseCm>} />
        <Route path="bons"                  element={<AutoriseCm codes={DROITS_BONS}><BonsPage /></AutoriseCm>} />
        <Route path="bons/nouveau"          element={<AutoriseCm codes={['com.bc.preparer']}><BonFormPage key="n" /></AutoriseCm>} />
        <Route path="bons/:id"              element={<AutoriseCm codes={DROITS_BONS}><BonPage /></AutoriseCm>} />
        <Route path="bons/:id/modifier"     element={<AutoriseCm codes={['com.bc.preparer']}><BonFormPage key="m" /></AutoriseCm>} />
        <Route path="tableau-bord"          element={<AutoriseCm codes={['com.tableau_bord.voir']}><TableauBordPage /></AutoriseCm>} />
        <Route path="documents"             element={<AutoriseCm codes={DROITS_BONS}><DocumentsPage /></AutoriseCm>} />
        <Route path="historique"            element={<AutoriseCm codes={DROITS_HISTORIQUE}><HistoriquePage /></AutoriseCm>} />
        <Route path="stock"                 element={<AutoriseCm codes={['com.stock.voir']}><StockEtatPage /></AutoriseCm>} />
        <Route path="stock/nouveau"         element={<AutoriseCm codes={DROITS_SAISIE}><StockDocFormPage key="n" /></AutoriseCm>} />
        <Route path="stock/validation"      element={<AutoriseCm codes={['com.stock.valider']}><StockDocsPage key="v" validation /></AutoriseCm>} />
        <Route path="stock/mouvements"      element={<AutoriseCm codes={['com.stock.journal']}><StockMouvementsPage /></AutoriseCm>} />
        <Route path="stock/valorisation"    element={<AutoriseCm codes={['com.stock.valorisation']}><StockValorisationPage /></AutoriseCm>} />
        <Route path="stock/documents/:id"   element={<AutoriseCm codes={DROITS_STOCK}><StockDocPage /></AutoriseCm>} />
        <Route path="stock/documents/:id/modifier" element={<AutoriseCm codes={DROITS_SAISIE}><StockDocFormPage key="m" /></AutoriseCm>} />
        <Route path="stock/:route"          element={<AutoriseCm codes={DROITS_STOCK}><StockDocsPage key="l" /></AutoriseCm>} />
        <Route path="*"            element={<Navigate to="/commercial" replace />} />
      </Route>
      <Route element={<GardeCaisse><Layout /></GardeCaisse>}>
        {/* Accueil du super_admin : l'administration (plateforme, ou configuration
            du client choisi) — jamais directement les données de caisse, qui
            demandent un accès support (voir middleware/tenant.js). */}
        <Route index element={user?.role === 'super_admin'
          ? <Navigate to={activeTenantId ? '/config' : '/plateforme'} replace />
          : user?.role === 'commercial' ? <Navigate to="/mynjbusiness" replace />
          : <DashboardPage />} />
        <Route path="journal/:id"    element={<Autorise code="journal.view"><JournalPage /></Autorise>} />
        <Route path="journaux-recap" element={<Autorise code={PAGE_PERMS['/journaux-recap']}><JournauxRecapPage /></Autorise>} />
        <Route path="budget"         element={<Autorise code={PAGE_PERMS['/budget']}><BudgetPage /></Autorise>} />
        <Route path="previsions"     element={<Autorise code={PAGE_PERMS['/previsions']}><PrevisionsPage /></Autorise>} />
        <Route path="appel-fonds"    element={<Autorise code={PAGE_PERMS['/appel-fonds']}><AppelFondsPage /></Autorise>} />
        <Route path="compte-emploi"  element={<Autorise code={PAGE_PERMS['/compte-emploi']}><CompteEmploiPage /></Autorise>} />
        <Route path="activites"      element={<Autorise code={PAGE_PERMS['/activites']}><SuiviActivitesPage /></Autorise>} />
        <Route path="controle/pieces"     element={<Autorise code={PAGE_PERMS['/controle/pieces']}><ControlePage /></Autorise>} />
        <Route path="controle/regularite" element={<Autorise code={PAGE_PERMS['/controle/regularite']}><ControlePage /></Autorise>} />
        <Route path="controle/arretes"    element={<Autorise code={PAGE_PERMS['/controle/arretes']}><ArretsInventairesPage /></Autorise>} />
        <Route path="controle/registre"   element={<Autorise code={PAGE_PERMS['/controle/registre']}><RegistreTiersPage /></Autorise>} />
        <Route path="controle/passerelle" element={<Autorise code={PAGE_PERMS['/controle/passerelle']}><PasserelleTab /></Autorise>} />
        <Route path="config"         element={<Autorise ok={voitConfiguration(user, can)}><ConfigPage /></Autorise>} />
        <Route path="attente"        element={<Autorise code={PAGE_PERMS['/attente']}><AttentePage /></Autorise>} />
        <Route path="tenants"        element={<TenantsPage />} />
        <Route path="permissions"    element={<PermissionsPage />} />
        <Route path="plan-modele"    element={<Autorise ok={user?.role === 'super_admin'}><PlanModelePage /></Autorise>} />
        <Route path="plateforme"     element={<Autorise ok={user?.role === 'super_admin'}><PlateformePage /></Autorise>} />
        <Route path="validation-directe" element={<Autorise ok={user?.role === 'super_admin'}><ValidationDirectePage /></Autorise>} />
        <Route path="mynjbusiness"   element={<Autorise ok={peutGererProspects(user, can)}><MyNjBusinessPage /></Autorise>} />
        <Route path="prospects"      element={<Autorise ok={peutGererProspects(user, can)}><ProspectsPage /></Autorise>} />
        <Route path="*"              element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
