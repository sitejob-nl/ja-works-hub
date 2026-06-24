import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";

// Context providers, layouts and route guards stay eager: they form the shell that
// renders on (nearly) every navigation, so the Suspense fallback below only covers
// the lazily-loaded page content — never the chrome (sidebar, providers).
import { AuthProvider } from "@/contexts/AuthContext";
import { RecentItemsProvider } from "@/contexts/RecentItemsContext";
import { SuperAdminProvider } from "@/contexts/SuperAdminContext";
import { PortalProvider } from "@/contexts/PortalContext";
import { ClientPortalProvider } from "@/contexts/ClientPortalContext";
import { TranslationProvider } from "@/contexts/TranslationContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import TenantHostGuard from "@/components/TenantHostGuard";
import AppLayout from "@/components/layout/AppLayout";
import SuperAdminLayout from "@/components/layout/SuperAdminLayout";
import PortalLayout from "@/components/layout/PortalLayout";
import ClientPortalLayout from "@/components/layout/ClientPortalLayout";

// Route pages are lazy-loaded so each page (and its heavy deps: pdfjs, tesseract,
// spreadsheet parsers, recharts, tiptap) splits into its own chunk and is only
// fetched when its route is first visited — keeping it off the initial bundle.
const Login = lazy(() => import("@/pages/Login"));
const SuperAdminLogin = lazy(() => import("@/pages/SuperAdminLogin"));
const SuperAdminDashboard = lazy(() => import("@/pages/superadmin/SuperAdminDashboard"));
const SuperAdminOrganizations = lazy(() => import("@/pages/superadmin/SuperAdminOrganizations"));
const SuperAdminUsers = lazy(() => import("@/pages/superadmin/SuperAdminUsers"));
const SuperAdminPlans = lazy(() => import("@/pages/superadmin/SuperAdminPlans"));
const SuperAdminErrors = lazy(() => import("@/pages/superadmin/SuperAdminErrors"));
const SuperAdminCvBackfill = lazy(() => import("@/pages/superadmin/SuperAdminCvBackfill"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const NotFound = lazy(() => import("./pages/NotFound"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const Planning = lazy(() => import("@/pages/Planning"));
const Companies = lazy(() => import("@/pages/Companies"));
const CompanyNew = lazy(() => import("@/pages/CompanyNew"));
const CompanyDetail = lazy(() => import("@/pages/CompanyDetail"));
const CompanyEdit = lazy(() => import("@/pages/CompanyEdit"));
const Candidates = lazy(() => import("@/pages/Candidates"));
const DuplicateCandidates = lazy(() => import("@/pages/DuplicateCandidates"));
const CandidateNew = lazy(() => import("@/pages/CandidateNew"));
const CandidateDetail = lazy(() => import("@/pages/CandidateDetail"));
const Employees = lazy(() => import("@/pages/Employees"));
const EmployeeNew = lazy(() => import("@/pages/EmployeeNew"));
const EmployeeDetail = lazy(() => import("@/pages/EmployeeDetail"));
const Housing = lazy(() => import("@/pages/Housing"));
const PropertyDetail = lazy(() => import("@/pages/PropertyDetail"));
const Vacancies = lazy(() => import("@/pages/Vacancies"));
const VacancyNew = lazy(() => import("@/pages/VacancyNew"));
const VacancyDetail = lazy(() => import("@/pages/VacancyDetail"));
const VacancyEdit = lazy(() => import("@/pages/VacancyEdit"));
const Timesheets = lazy(() => import("@/pages/Timesheets"));
const Transport = lazy(() => import("@/pages/Transport"));
const VehicleNew = lazy(() => import("@/pages/VehicleNew"));
const VehicleDetail = lazy(() => import("@/pages/VehicleDetail"));
const VehicleEdit = lazy(() => import("@/pages/VehicleEdit"));
const Vacaturebank = lazy(() => import("@/pages/Vacaturebank"));
const KandidatenZoeken = lazy(() => import("@/pages/KandidatenZoeken"));
const Communications = lazy(() => import("@/pages/Communications"));
const KnowledgeBasePage = lazy(() => import("@/pages/KnowledgeBase"));
const WhatsAppPage = lazy(() => import("@/pages/WhatsApp"));
const ExactOnlinePage = lazy(() => import("@/pages/ExactOnline"));
const OmzetPage = lazy(() => import("@/pages/Omzet"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const CvTool = lazy(() => import("@/pages/CvTool"));
const RecruiterWorkbench = lazy(() => import("@/pages/RecruiterWorkbench"));
const Tasks = lazy(() => import("@/pages/Tasks"));
const BulkCampaigns = lazy(() => import("@/pages/BulkCampaigns"));
const BulkCampaignDetail = lazy(() => import("@/pages/BulkCampaignDetail"));
const ImportData = lazy(() => import("@/pages/ImportData"));
const CarerixImport = lazy(() => import("@/pages/CarerixImport"));
const Installeren = lazy(() => import("@/pages/Installeren"));
const ContractSign = lazy(() => import("@/pages/ContractSign"));
const CandidateProfile = lazy(() => import("@/pages/CandidateProfile"));
const PublicCandidateSignup = lazy(() => import("@/pages/PublicCandidateSignup"));
const Register = lazy(() => import("@/pages/Register"));
const PortalActivate = lazy(() => import("@/pages/PortalActivate"));
const FuelCardAnalysis = lazy(() => import("@/pages/FuelCardAnalysis"));
const FiscalMileageAnalysis = lazy(() => import("@/pages/FiscalMileageAnalysis"));
const InvoicesPage = lazy(() => import("@/pages/Invoices"));
const PlacementsPage = lazy(() => import("@/pages/Placements"));
const PlacementDetail = lazy(() => import("@/pages/PlacementDetail"));
const MatchPipeline = lazy(() => import("@/pages/MatchPipeline"));
const MatchResponse = lazy(() => import("@/pages/MatchResponse"));
const UitstroomAnalyse = lazy(() => import("@/pages/UitstroomAnalyse"));
const Contacts = lazy(() => import("@/pages/Contacts"));
const ContactDetail = lazy(() => import("@/pages/ContactDetail"));
const Dashboards = lazy(() => import("@/pages/Dashboards"));
const Email = lazy(() => import("@/pages/Email"));
const Agenda = lazy(() => import("@/pages/Agenda"));
const EmailTemplates = lazy(() => import("@/pages/EmailTemplates"));
const Talentpools = lazy(() => import("@/pages/Talentpools"));
const TalentpoolDetail = lazy(() => import("@/pages/TalentpoolDetail"));
const PortalLogin = lazy(() => import("@/pages/portal/PortalLogin"));
const PortalDashboard = lazy(() => import("@/pages/portal/PortalDashboard"));
const PortalTimesheets = lazy(() => import("@/pages/portal/PortalTimesheets"));
const PortalDocuments = lazy(() => import("@/pages/portal/PortalDocuments"));
const PortalJobMarket = lazy(() => import("@/pages/portal/PortalJobMarket"));
const PortalProfile = lazy(() => import("@/pages/portal/PortalProfile"));
const PortalSickReport = lazy(() => import("@/pages/portal/PortalSickReport"));
const PortalHousing = lazy(() => import("@/pages/portal/PortalHousing"));
const PortalVehicle = lazy(() => import("@/pages/portal/PortalVehicle"));
const PortalLoyalty = lazy(() => import("@/pages/portal/PortalLoyalty"));
const PortalPayslips = lazy(() => import("@/pages/portal/PortalPayslips"));
const PortalAnnualStatements = lazy(() => import("@/pages/portal/PortalAnnualStatements"));
const PortalHourLetters = lazy(() => import("@/pages/portal/PortalHourLetters"));
const PortalPlacements = lazy(() => import("@/pages/portal/PortalPlacements"));
const ClientPortalActivate = lazy(() => import("@/pages/ClientPortalActivate"));
const ClientPortalLogin = lazy(() => import("@/pages/clientportal/ClientPortalLogin"));
const ClientPortalDashboard = lazy(() => import("@/pages/clientportal/ClientPortalDashboard"));
const ClientPortalTimesheets = lazy(() => import("@/pages/clientportal/ClientPortalTimesheets"));
const ClientPortalPlacements = lazy(() => import("@/pages/clientportal/ClientPortalPlacements"));

const queryClient = new QueryClient();

const CandidateEditRedirect = () => {
  const { id } = useParams();
  return <Navigate to={id ? `/kandidaten/${id}?tab=profiel` : "/kandidaten"} replace />;
};

// Shown while a route's chunk is being fetched. Centered so it reads as a page
// loading state rather than a layout shift.
const PageFallback = () => (
  <div className="flex h-screen w-full items-center justify-center text-sm text-muted-foreground">
    Laden…
  </div>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              {/* Superadmin routes */}
              <Route path="/superadmin/login" element={
                <SuperAdminProvider><SuperAdminLogin /></SuperAdminProvider>
              } />
              <Route path="/superadmin" element={
                <SuperAdminProvider><SuperAdminLayout /></SuperAdminProvider>
              }>
                <Route index element={<SuperAdminDashboard />} />
                <Route path="organisaties" element={<SuperAdminOrganizations />} />
                <Route path="gebruikers" element={<SuperAdminUsers />} />
                <Route path="abonnementen" element={<SuperAdminPlans />} />
                <Route path="cv-backfill" element={<SuperAdminCvBackfill />} />
                <Route path="errors" element={<SuperAdminErrors />} />
              </Route>

              {/* Normal app routes */}
              <Route path="/login" element={
                <AuthProvider><Login /></AuthProvider>
              } />
              <Route path="/registreren" element={<Register />} />
              <Route element={
                <AuthProvider>
                  <ProtectedRoute>
                    <RecentItemsProvider>
                      <TenantHostGuard>
                        <AppLayout />
                      </TenantHostGuard>
                    </RecentItemsProvider>
                  </ProtectedRoute>
                </AuthProvider>
              }>
                <Route path="/" element={<Dashboard />} />
                <Route path="/workbench" element={<RecruiterWorkbench />} />
                <Route path="/taken" element={<Tasks />} />
                <Route path="/opdrachtgevers" element={<Companies />} />
                <Route path="/opdrachtgevers/new" element={<CompanyNew />} />
                <Route path="/opdrachtgevers/:id" element={<CompanyDetail />} />
                <Route path="/opdrachtgevers/:id/bewerken" element={<CompanyEdit />} />
                <Route path="/kandidaten" element={<Candidates />} />
                <Route path="/kandidaten/new" element={<CandidateNew />} />
                <Route path="/kandidaten/duplicaten" element={<DuplicateCandidates />} />
                <Route path="/kandidaten/:id" element={<CandidateDetail />} />
                <Route path="/kandidaten/:id/bewerken" element={<CandidateEditRedirect />} />
                <Route path="/medewerkers" element={<Navigate to="/kandidaten?tab=in-dienst" replace />} />
                <Route path="/medewerkers/new" element={<EmployeeNew />} />
                <Route path="/medewerkers/:id" element={<EmployeeDetail />} />
                <Route path="/contacten" element={<Contacts />} />
                <Route path="/contacten/:id" element={<ContactDetail />} />
                <Route path="/talentpools" element={<Talentpools />} />
                <Route path="/talentpools/:id" element={<TalentpoolDetail />} />
                <Route path="/huisvesting" element={<Housing />} />
                <Route path="/huisvesting/:id" element={<PropertyDetail />} />
                <Route path="/vacatures" element={<Vacancies />} />
                <Route path="/vacatures/new" element={<VacancyNew />} />
                <Route path="/vacatures/:id" element={<VacancyDetail />} />
                <Route path="/vacatures/:id/bewerken" element={<VacancyEdit />} />
                <Route path="/match-pipeline" element={<MatchPipeline />} />
                <Route path="/planning" element={<Planning />} />
                <Route path="/plaatsingen" element={<PlacementsPage />} />
                <Route path="/plaatsingen/:id" element={<PlacementDetail />} />
                <Route path="/uren" element={<Timesheets />} />
                <Route path="/facturatie" element={<InvoicesPage />} />
                <Route path="/uitstroom-analyse" element={<UitstroomAnalyse />} />
                <Route path="/transport" element={<Transport />} />
                <Route path="/transport/new" element={<VehicleNew />} />
                <Route path="/transport/:id" element={<VehicleDetail />} />
                <Route path="/transport/:id/bewerken" element={<VehicleEdit />} />
                <Route path="/tankpas-analyse" element={<FuelCardAnalysis />} />
                <Route path="/kilometeranalyse" element={<FiscalMileageAnalysis />} />
                <Route path="/vacaturebank" element={<Vacaturebank />} />
                <Route path="/kandidaten-zoeken" element={<KandidatenZoeken />} />
                <Route path="/communicatie" element={<Communications />} />
                <Route path="/email" element={<Email />} />
                <Route path="/email/templates" element={<EmailTemplates />} />
                <Route path="/agenda" element={<Agenda />} />
                <Route path="/whatsapp" element={<WhatsAppPage />} />
                <Route path="/bulk-campaigns" element={<BulkCampaigns />} />
                <Route path="/bulk-campaigns/:id" element={<BulkCampaignDetail />} />
                <Route path="/kennisbank" element={<KnowledgeBasePage />} />
                <Route path="/exact-online" element={<ExactOnlinePage />} />
                <Route path="/omzet" element={<OmzetPage />} />
                <Route path="/cv-tool/:candidateId" element={<CvTool />} />
                <Route path="/importeren" element={<ImportData />} />
                <Route path="/carerix-import" element={<CarerixImport />} />
                <Route path="/dashboards" element={<Dashboards />} />
                <Route path="/instellingen" element={<SettingsPage />} />
              </Route>
              {/* Public routes */}
              <Route path="/onboarding/:token" element={<Onboarding />} />
              <Route path="/contract/sign/:token" element={<ContractSign />} />
              <Route path="/match-response/:token" element={<MatchResponse />} />
              <Route path="/match/reageer/:token" element={<MatchResponse />} />
              <Route path="/profiel/:token" element={<CandidateProfile />} />
              <Route path="/solliciteren/:slug" element={<PublicCandidateSignup />} />
              <Route path="/portaal/activeren/:token" element={<TranslationProvider enableRuntimeTranslation={false}><PortalActivate /></TranslationProvider>} />
              <Route path="/portaal/login" element={<TranslationProvider enableRuntimeTranslation={false}><PortalLogin /></TranslationProvider>} />
              {/* Client portal (opdrachtgever) public routes */}
              <Route path="/klantportaal/activeren/:token" element={<TranslationProvider enableRuntimeTranslation={false}><ClientPortalActivate /></TranslationProvider>} />
              <Route path="/klantportaal/login" element={<TranslationProvider enableRuntimeTranslation={false}><ClientPortalLogin /></TranslationProvider>} />
              {/* Portal (medewerker) routes */}
              <Route path="/portaal" element={
                <PortalProvider><PortalLayout /></PortalProvider>
              }>
                <Route index element={<PortalDashboard />} />
                <Route path="uren" element={<PortalTimesheets />} />
                <Route path="plaatsingen" element={<PortalPlacements />} />
                <Route path="documenten" element={<PortalDocuments />} />
                <Route path="vacatures" element={<PortalJobMarket />} />
                <Route path="profiel" element={<PortalProfile />} />
                <Route path="ziekmelding" element={<PortalSickReport />} />
                <Route path="huisvesting" element={<PortalHousing />} />
                <Route path="voertuig" element={<PortalVehicle />} />
                <Route path="punten" element={<PortalLoyalty />} />
                <Route path="loonstroken" element={<PortalPayslips />} />
                <Route path="jaaropgaven" element={<PortalAnnualStatements />} />
                <Route path="urenbrieven" element={<PortalHourLetters />} />
              </Route>
              {/* Client portal (opdrachtgever) protected routes */}
              <Route path="/klantportaal" element={
                <ClientPortalProvider><ClientPortalLayout /></ClientPortalProvider>
              }>
                <Route index element={<ClientPortalDashboard />} />
                <Route path="uren" element={<ClientPortalTimesheets />} />
                <Route path="plaatsingen" element={<ClientPortalPlacements />} />
              </Route>
              <Route path="/installeren" element={<Installeren />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
