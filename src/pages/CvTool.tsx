import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import CvTemplate from '@/components/cv/CvTemplate';
import CvSettingsPanel from '@/components/cv/CvSettingsPanel';

interface CvSections {
  summary: string;
  experience: string;
  skills: string;
  education: string;
  languages: string;
  certifications: string;
}

const emptySections: CvSections = { summary: '', experience: '', skills: '', education: '', languages: '', certifications: '' };

const CvTool = () => {
  const { candidateId } = useParams<{ candidateId: string }>();
  const orgId = useOrganizationId();

  const [language, setLanguage] = useState('nl');
  const [anonymous, setAnonymous] = useState(false);
  const [sections, setSections] = useState<CvSections>(emptySections);
  const [visibleSections, setVisibleSections] = useState<Record<string, boolean>>({
    summary: true, experience: true, skills: true, education: true, languages: true, certifications: true,
  });
  const [isRewriting, setIsRewriting] = useState(false);

  const { data: candidate, isLoading } = useQuery({
    queryKey: ['candidate', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('candidates').select('*').eq('id', candidateId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!candidateId,
  });

  const { data: org } = useQuery({
    queryKey: ['organization', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('name, logo_url').eq('id', orgId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: placements } = useQuery({
    queryKey: ['candidate-placements-cv', candidateId],
    queryFn: async () => {
      // Get employee first
      const { data: emp } = await supabase.from('employees').select('id').eq('candidate_id', candidateId!).maybeSingle();
      if (!emp) return [];
      const { data, error } = await supabase
        .from('placements')
        .select('function_name, start_date, end_date, status, companies(name)')
        .eq('employee_id', emp.id)
        .order('start_date', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!candidateId,
  });

  const handleRewrite = async () => {
    if (!candidate) return;
    setIsRewriting(true);
    try {
      const { data, error } = await supabase.functions.invoke('cv-rewrite', {
        body: { candidate, placements: placements || [], language, anonymous },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      setSections(data.sections);
      toast.success('CV herschreven door AI');
    } catch (e: any) {
      toast.error(e.message || 'AI herschrijven mislukt');
    } finally {
      setIsRewriting(false);
    }
  };

  const handleDownload = () => {
    window.print();
  };

  const toggleSection = (key: string) => {
    setVisibleSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const hasSections = Object.values(sections).some(v => !!v);

  if (isLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!candidate) return <div className="p-8 text-muted-foreground">Kandidaat niet gevonden</div>;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm text-muted-foreground print:hidden">
        <Link to="/kandidaten" className="hover:text-foreground transition-colors">Kandidaten</Link>
        <ChevronRight className="h-3 w-3" />
        <Link to={`/kandidaten/${candidateId}`} className="hover:text-foreground transition-colors">
          {candidate.first_name} {candidate.last_name}
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">CV Tool</span>
      </div>

      <h1 className="text-2xl font-semibold print:hidden">CV Generator</h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Settings panel */}
        <div className="lg:col-span-1 print:hidden">
          <div className="bg-card border border-border rounded-lg p-5 sticky top-4">
            <h3 className="font-medium mb-4">Instellingen</h3>
            <CvSettingsPanel
              language={language}
              onLanguageChange={setLanguage}
              anonymous={anonymous}
              onAnonymousChange={setAnonymous}
              visibleSections={visibleSections}
              onToggleSection={toggleSection}
              onRewrite={handleRewrite}
              onDownload={handleDownload}
              isRewriting={isRewriting}
              hasSections={hasSections}
            />
          </div>
        </div>

        {/* CV Preview */}
        <div className="lg:col-span-3">
          {hasSections ? (
            <CvTemplate
              candidate={candidate}
              sections={sections}
              anonymous={anonymous}
              language={language}
              orgLogo={org?.logo_url}
              orgName={org?.name || 'Organisatie'}
              visibleSections={visibleSections}
            />
          ) : (
            <div className="bg-card border border-border rounded-lg p-12 text-center print:hidden">
              <p className="text-muted-foreground mb-2">Klik op "AI Herschrijven" om een professioneel CV te genereren</p>
              <p className="text-xs text-muted-foreground">
                Het CV wordt gegenereerd op basis van het profiel van {candidate.first_name} en eventuele plaatsingshistorie.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CvTool;
