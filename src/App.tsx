import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { SuperAdminProvider } from "@/contexts/SuperAdminContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import AppLayout from "@/components/layout/AppLayout";
import SuperAdminLayout from "@/components/layout/SuperAdminLayout";
import Login from "@/pages/Login";
import SuperAdminLogin from "@/pages/SuperAdminLogin";
import SuperAdminDashboard from "@/pages/superadmin/SuperAdminDashboard";
import SuperAdminOrganizations from "@/pages/superadmin/SuperAdminOrganizations";
import SuperAdminUsers from "@/pages/superadmin/SuperAdminUsers";
import SuperAdminPlans from "@/pages/superadmin/SuperAdminPlans";
import SuperAdminErrors from "@/pages/superadmin/SuperAdminErrors";
import Dashboard from "@/pages/Dashboard";
import NotFound from "./pages/NotFound";
import SettingsPage from "@/pages/Settings";
import Planning from "@/pages/Planning";
import Companies from "@/pages/Companies";
import CompanyNew from "@/pages/CompanyNew";
import CompanyDetail from "@/pages/CompanyDetail";
import CompanyEdit from "@/pages/CompanyEdit";
import Candidates from "@/pages/Candidates";
import CandidateNew from "@/pages/CandidateNew";
import CandidateDetail from "@/pages/CandidateDetail";
import CandidateEdit from "@/pages/CandidateEdit";
import Employees from "@/pages/Employees";
import EmployeeNew from "@/pages/EmployeeNew";
import EmployeeDetail from "@/pages/EmployeeDetail";
import Housing from "@/pages/Housing";
import PropertyDetail from "@/pages/PropertyDetail";
import Vacancies from "@/pages/Vacancies";
import VacancyNew from "@/pages/VacancyNew";
import VacancyDetail from "@/pages/VacancyDetail";
import VacancyEdit from "@/pages/VacancyEdit";
import Timesheets from "@/pages/Timesheets";
import Transport from "@/pages/Transport";
import VehicleNew from "@/pages/VehicleNew";
import VehicleDetail from "@/pages/VehicleDetail";
import VehicleEdit from "@/pages/VehicleEdit";
import Vacaturebank from "@/pages/Vacaturebank";
import KandidatenZoeken from "@/pages/KandidatenZoeken";
import Communications from "@/pages/Communications";
import KnowledgeBasePage from "@/pages/KnowledgeBase";
import WhatsAppPage from "@/pages/WhatsApp";
import ExactOnlinePage from "@/pages/ExactOnline";
import Onboarding from "@/pages/Onboarding";
import CvTool from "@/pages/CvTool";
import RecruiterWorkbench from "@/pages/RecruiterWorkbench";
import BulkCampaigns from "@/pages/BulkCampaigns";
import BulkCampaignDetail from "@/pages/BulkCampaignDetail";
import ImportData from "@/pages/ImportData";
import Installeren from "@/pages/Installeren";
import ContractSign from "@/pages/ContractSign";
import CandidateProfile from "@/pages/CandidateProfile";
import Register from "@/pages/Register";
import PortalActivate from "@/pages/PortalActivate";
import FuelCardAnalysis from "@/pages/FuelCardAnalysis";
import PortalLogin from "@/pages/portal/PortalLogin";
import PortalDashboard from "@/pages/portal/PortalDashboard";
import PortalLayout from "@/components/layout/PortalLayout";
import { PortalProvider } from "@/contexts/PortalContext";
import PortalTimesheets from "@/pages/portal/PortalTimesheets";
import PortalDocuments from "@/pages/portal/PortalDocuments";
import PortalProfile from "@/pages/portal/PortalProfile";
import PortalSickReport from "@/pages/portal/PortalSickReport";
import PortalHousing from "@/pages/portal/PortalHousing";
import PortalVehicle from "@/pages/portal/PortalVehicle";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
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
                  <AppLayout />
                </ProtectedRoute>
              </AuthProvider>
            }>
              <Route path="/" element={<Dashboard />} />
              <Route path="/workbench" element={<RecruiterWorkbench />} />
              <Route path="/opdrachtgevers" element={<Companies />} />
              <Route path="/opdrachtgevers/new" element={<CompanyNew />} />
              <Route path="/opdrachtgevers/:id" element={<CompanyDetail />} />
              <Route path="/opdrachtgevers/:id/bewerken" element={<CompanyEdit />} />
              <Route path="/kandidaten" element={<Candidates />} />
              <Route path="/kandidaten/new" element={<CandidateNew />} />
              <Route path="/kandidaten/:id" element={<CandidateDetail />} />
              <Route path="/kandidaten/:id/bewerken" element={<CandidateEdit />} />
              <Route path="/medewerkers" element={<Employees />} />
              <Route path="/medewerkers/new" element={<EmployeeNew />} />
              <Route path="/medewerkers/:id" element={<EmployeeDetail />} />
              <Route path="/huisvesting" element={<Housing />} />
              <Route path="/huisvesting/:id" element={<PropertyDetail />} />
              <Route path="/vacatures" element={<Vacancies />} />
              <Route path="/vacatures/new" element={<VacancyNew />} />
              <Route path="/vacatures/:id" element={<VacancyDetail />} />
              <Route path="/vacatures/:id/bewerken" element={<VacancyEdit />} />
              <Route path="/planning" element={<Planning />} />
              <Route path="/uren" element={<Timesheets />} />
              <Route path="/transport" element={<Transport />} />
              <Route path="/transport/new" element={<VehicleNew />} />
              <Route path="/transport/:id" element={<VehicleDetail />} />
              <Route path="/transport/:id/bewerken" element={<VehicleEdit />} />
              <Route path="/tankpas-analyse" element={<FuelCardAnalysis />} />
              <Route path="/vacaturebank" element={<Vacaturebank />} />
              <Route path="/kandidaten-zoeken" element={<KandidatenZoeken />} />
              <Route path="/communicatie" element={<Communications />} />
              <Route path="/whatsapp" element={<WhatsAppPage />} />
              <Route path="/bulk-campaigns" element={<BulkCampaigns />} />
              <Route path="/bulk-campaigns/:id" element={<BulkCampaignDetail />} />
              <Route path="/kennisbank" element={<KnowledgeBasePage />} />
              <Route path="/exact-online" element={<ExactOnlinePage />} />
              <Route path="/cv-tool/:candidateId" element={<CvTool />} />
              <Route path="/importeren" element={<ImportData />} />
              <Route path="/instellingen" element={<SettingsPage />} />
            </Route>
            {/* Public routes */}
            <Route path="/onboarding/:token" element={<Onboarding />} />
            <Route path="/contract/sign/:token" element={<ContractSign />} />
            <Route path="/profiel/:token" element={<CandidateProfile />} />
            <Route path="/portaal/activeren/:token" element={<PortalActivate />} />
            <Route path="/portaal/login" element={<PortalLogin />} />
            {/* Portal (medewerker) routes */}
            <Route path="/portaal" element={
              <PortalProvider><PortalLayout /></PortalProvider>
            }>
              <Route index element={<PortalDashboard />} />
              <Route path="uren" element={<PortalTimesheets />} />
              <Route path="documenten" element={<PortalDocuments />} />
              <Route path="profiel" element={<PortalProfile />} />
              <Route path="ziekmelding" element={<PortalSickReport />} />
              <Route path="huisvesting" element={<PortalHousing />} />
              <Route path="voertuig" element={<PortalVehicle />} />
            </Route>
            <Route path="/installeren" element={<Installeren />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
