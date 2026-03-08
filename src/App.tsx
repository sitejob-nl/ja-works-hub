import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import NotFound from "./pages/NotFound";
import ShellPage from "@/components/ShellPage";
import Companies from "@/pages/Companies";
import CompanyDetail from "@/pages/CompanyDetail";
import Candidates from "@/pages/Candidates";
import CandidateDetail from "@/pages/CandidateDetail";
import {
  Building2, Users, UserCheck, Home, Briefcase,
  Calendar, Clock, Car, MessageSquare, BookOpen, Settings,
} from "lucide-react";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/opdrachtgevers" element={<Companies />} />
              <Route path="/opdrachtgevers/:id" element={<CompanyDetail />} />
              <Route path="/kandidaten" element={<Candidates />} />
              <Route path="/kandidaten/:id" element={<CandidateDetail />} />
              <Route path="/medewerkers" element={<ShellPage title="Medewerkers" subtitle="Beheer actieve medewerkers" icon={UserCheck} />} />
              <Route path="/huisvesting" element={<ShellPage title="Huisvesting" subtitle="Beheer panden, kamers en toewijzingen" icon={Home} />} />
              <Route path="/vacatures" element={<ShellPage title="Vacatures" subtitle="Openstaande en vervulde vacatures" icon={Briefcase} />} />
              <Route path="/planning" element={<ShellPage title="Planning" subtitle="Plan en beheer de inzet van medewerkers" icon={Calendar} />} />
              <Route path="/uren" element={<ShellPage title="Uren" subtitle="Urenregistratie en goedkeuring" icon={Clock} />} />
              <Route path="/transport" element={<ShellPage title="Transport" subtitle="Voertuigen, toewijzingen en kilometerregistratie" icon={Car} />} />
              <Route path="/communicatie" element={<ShellPage title="Communicatie" subtitle="Berichten en communicatiehistorie" icon={MessageSquare} />} />
              <Route path="/kennisbank" element={<ShellPage title="Kennisbank" subtitle="Interne kennisbank en documentatie" icon={BookOpen} />} />
              <Route path="/instellingen" element={<ShellPage title="Instellingen" subtitle="Organisatie- en gebruikersinstellingen" icon={Settings} />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
