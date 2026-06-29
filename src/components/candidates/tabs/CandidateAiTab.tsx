import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Brain,
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  ArrowDownToLine,
  Share2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import AiAnalysisCard from '@/components/AiAnalysisCard';
import AiAnalysisShareDialog from '@/components/candidates/AiAnalysisShareDialog';
import { logAudit } from '@/lib/audit';
import { CV_ACCEPT, extractCvTextFromFile } from '@/lib/cvText';
import { extractFunctionErrorMessage } from '@/lib/functionError';

const formatEuro = (cents: number) =>
  (cents / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });

const CandidateAiTab = ({ candidate: initialCandidate }: { candidate: any }) => {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cvText, setCvText] = useState(initialCandidate.cv_raw_text || '');
  const [candidate, setCandidate] = useState(initialCandidate);
  const [extracting, setExtracting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Realtime subscription on this candidate's ai_status
  useEffect(() => {
    const channel = supabase
      .channel(`candidate-ai-${candidate.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'candidates',
          filter: `id=eq.${candidate.id}`,
        },
        (payload) => {
          const updated = payload.new as any;
          setCandidate((prev: any) => ({ ...prev, ...updated }));

          if (updated.ai_status === 'completed') {
            toast.success('Dossieranalyse voltooid!');
            qc.invalidateQueries({ queryKey: ['candidate', candidate.id] });
          } else if (updated.ai_status === 'failed') {
            toast.error('Dossieranalyse mislukt. Probeer het opnieuw.');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [candidate.id, qc]);

  // Extract text from uploaded CV/document/image and store the original file.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      toast.error('Bestand is te groot (maximaal 15 MB)');
      return;
    }

    setExtracting(true);
    try {
      // Upload to Supabase storage for reference
      const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
      const filePath = `${candidate.organization_id}/${candidate.id}/cv_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file, { upsert: true, contentType: file.type || undefined });

      if (uploadError) {
        console.warn('Storage upload failed (non-critical):', uploadError);
      } else {
        // Save file URL to candidate
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);
        await supabase
          .from('candidates')
          .update({ cv_file_url: urlData.publicUrl })
          .eq('id', candidate.id);
        // Leg het CV ook vast als document-rij zodat het op het Documenten-tabblad verschijnt (DOC1).
        const { error: docError } = await supabase.from('documents').insert({
          candidate_id: candidate.id,
          organization_id: candidate.organization_id,
          type: 'cv',
          name: file.name,
          file_path: filePath,
          source: 'cv_analyse',
        });
        if (docError) console.warn('Document-rij voor CV aanmaken mislukt (niet-kritiek):', docError.message);
        else qc.invalidateQueries({ queryKey: ['documents', candidate.id] });
      }

      const text = await extractCvTextFromFile(file);

      if (text.length > 100) {
        const cleaned = text.replace(/\n{3,}/g, '\n\n').trim();
        setCvText(cleaned);
        toast.success(`Tekst uit ${file.name} geëxtraheerd (${cleaned.length} tekens)`);
      } else {
        toast.info('Bestand bevat te weinig herkenbare tekst. Controleer het bestand of plak de tekst hieronder.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Fout bij het lezen van het bestand');
      console.error(err);
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Trigger AI analysis. The edge function is Gemini-only; provider selection was removed.
  const analyzeMutation = useMutation({
    mutationFn: async () => {
      if (!cvText || cvText.trim().length < 50) {
        throw new Error('CV tekst is te kort (minimaal 50 tekens)');
      }

      const body = {
        cv_text: cvText,
        candidate_id: candidate.id,
      };

      const { data, error } = await supabase.functions.invoke('analyze-cv', { body });

      if (error) {
        throw new Error(await extractFunctionErrorMessage(error, 'Kon analyse niet starten'));
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: async (data) => {
      if (data?.status === 'completed') {
        // Gemini-pad is synchroon; haal verse data op zodat UI ai_* velden ziet.
        const { data: fresh } = await supabase
          .from('candidates')
          .select('*')
          .eq('id', candidate.id)
          .single();
        if (fresh) setCandidate(fresh);
        qc.invalidateQueries({ queryKey: ['candidate', candidate.id] });
        toast.success(
          `Analyse voltooid (Gemini, ${formatEuro(data.cost_cents ?? 0)} verbruikt)`,
        );
      } else {
        setCandidate((prev: any) => ({ ...prev, ai_status: 'analyzing' }));
        toast.success('Analyse gestart — resultaat verschijnt automatisch');
      }
    },
    onError: (e: Error & { balance_cents?: number }) => {
      if (e.message?.toLowerCase().includes('saldo')) {
        toast.error(`${e.message}. Vraag SiteJob om bijvullen.`);
        return;
      }
      toast.error(e.message || 'Kon analyse niet starten');
    },
  });

  const isAnalyzing = candidate.ai_status === 'analyzing' || analyzeMutation.isPending;
  const hasAnalysis = candidate.ai_status === 'completed' && candidate.ai_analysis;
  const hasFailed = candidate.ai_status === 'failed';

  return (
    <div className="space-y-6">
      {/* Status bar */}
      {isAnalyzing && (
        <Card className="p-4 border-l-4 border-l-blue-500 bg-blue-50/50">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
            <div>
              <p className="font-medium text-sm">Kandidaatdossier wordt geanalyseerd...</p>
              <p className="text-xs text-muted-foreground">CV, profiel en interne notities worden meegenomen. Dit duurt meestal enkele seconden.</p>
            </div>
          </div>
        </Card>
      )}

      {hasFailed && (
        <Card className="p-4 border-l-4 border-l-red-500 bg-red-50/50">
          <div className="flex items-center gap-3">
            <XCircle className="h-5 w-5 text-red-500" />
            <div>
              <p className="font-medium text-sm">Analyse mislukt</p>
              <p className="text-xs text-muted-foreground">Probeer het opnieuw of pas de CV-/dossierinput aan.</p>
            </div>
          </div>
        </Card>
      )}

      {hasAnalysis && candidate.ai_analyzed_at && (
        <Card className="p-4 border-l-4 border-l-stat-green bg-stat-green/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-stat-green" />
              <div>
                <p className="font-medium text-sm">Analyse voltooid</p>
                <p className="text-xs text-muted-foreground">
                  Geanalyseerd op {formatDate(candidate.ai_analyzed_at)}
                  {candidate.ai_reliability_score != null && ` — Plaatsbaarheid: ${candidate.ai_reliability_score}/10`}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShareOpen(true)}
                disabled={isAnalyzing}
                className="gap-1.5"
              >
                <Share2 className="h-3.5 w-3.5" />
                Deel met opdrachtgever
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isAnalyzing}
                onClick={() => analyzeMutation.mutate()}
                className="gap-1.5"
              >
                <Brain className="h-3.5 w-3.5" />
                Opnieuw analyseren
              </Button>
            </div>
          </div>
        </Card>
      )}

      <AiAnalysisShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        candidate={candidate}
      />


      {/* CV Input section */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium text-sm">CV Tekst / dossierinput</h3>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={CV_ACCEPT}
              className="hidden"
              onChange={handleFileUpload}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={extracting || isAnalyzing}
              className="gap-1.5"
            >
              {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Bestand uploaden
            </Button>
          </div>
        </div>

        <Textarea
          value={cvText}
          onChange={(e) => setCvText(e.target.value)}
          placeholder="Plak hier de CV-tekst van de kandidaat, of upload een PDF, Word-document of afbeelding hierboven. Interne notities worden server-side automatisch toegevoegd."
          className="min-h-[200px] font-mono text-xs leading-relaxed"
          disabled={isAnalyzing}
        />

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {cvText.length > 0 ? `${cvText.length} tekens` : 'Nog geen tekst'}
            {cvText.length > 0 && cvText.length < 50 && ' — minimaal 50 tekens nodig'}
          </p>
          <Button
            disabled={isAnalyzing || cvText.trim().length < 50}
            onClick={() => analyzeMutation.mutate()}
            className="gap-2"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyseren...
              </>
            ) : (
              <>
                <Brain className="h-4 w-4" />
                AI analyse starten
              </>
            )}
          </Button>
        </div>
      </Card>

      {/* Analysis results */}
      {hasAnalysis && (
        <>
          <AiAnalysisCard analysis={candidate.ai_analysis} />
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Profiel bijwerken vanuit AI-analyse</p>
              <p className="text-xs text-muted-foreground">Neem vaardigheden, certificaten en functiegroep over naar het profiel</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                const analysis = candidate.ai_analysis;
                const hardSkills: string[] = analysis?.competenties?.hard_skills || [];
                const softSkills: string[] = analysis?.competenties?.soft_skills || [];
                const certs: string[] = (analysis?.competenties?.certificaten || [])
                  .map((cert: any) => typeof cert === 'string' ? cert : cert?.naam)
                  .filter(Boolean);
                const allSkills = [...new Set([...hardSkills, ...softSkills])].filter(Boolean);

                const updates: Record<string, any> = {};
                if (allSkills.length > 0) updates.skills = allSkills;
                if (certs.length > 0) updates.certifications = certs;
                if (analysis?.doelgroep?.functies?.[0]) updates.ai_function_group = analysis.doelgroep.functies[0];
                if (analysis?.eigenschappen?.specialisatie) {
                  updates.ai_classification = analysis.eigenschappen.specialisatie === 'specialist' ? 'specialist' : 'productie';
                }

                if (Object.keys(updates).length === 0) {
                  toast.info('Geen gegevens om over te nemen');
                  return;
                }

                const { error } = await supabase.from('candidates').update(updates).eq('id', candidate.id);
                if (error) { toast.error(error.message); return; }
                logAudit({ action: 'update', tableName: 'candidates', recordId: candidate.id, newValues: updates, reason: 'AI analyse overgenomen naar profiel' });
                qc.invalidateQueries({ queryKey: ['candidate', candidate.id] });
                toast.success(`${Object.keys(updates).length} velden overgenomen naar profiel`);
              }}
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Overnemen naar profiel
            </Button>
          </Card>
        </>
      )}

      {/* Quick summary fields if present but no full analysis card */}
      {!hasAnalysis && candidate.ai_summary && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium text-sm">Eerdere AI Samenvatting</h3>
          </div>
          <p className="text-sm">{candidate.ai_summary}</p>
          {candidate.ai_reliability_score != null && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Plaatsbaarheid:</span>
              <Badge variant="outline">{candidate.ai_reliability_score}/10</Badge>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default CandidateAiTab;
