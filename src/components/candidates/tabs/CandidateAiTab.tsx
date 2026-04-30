import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Brain, Upload, Loader2, CheckCircle2, XCircle, FileText, Clock, ArrowDownToLine, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import AiAnalysisCard from '@/components/AiAnalysisCard';
import AiAnalysisShareDialog from '@/components/candidates/AiAnalysisShareDialog';
import { logAudit } from '@/lib/audit';

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
            toast.success('CV analyse voltooid!');
            qc.invalidateQueries({ queryKey: ['candidate', candidate.id] });
          } else if (updated.ai_status === 'failed') {
            toast.error('CV analyse mislukt. Probeer het opnieuw.');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [candidate.id, qc]);

  // Extract text from uploaded PDF using browser FileReader
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      toast.error('Alleen PDF bestanden worden ondersteund');
      return;
    }

    setExtracting(true);
    try {
      // Upload to Supabase storage for reference
      const filePath = `${candidate.organization_id}/${candidate.id}/cv_${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file, { upsert: true });

      if (uploadError) {
        console.warn('Storage upload failed (non-critical):', uploadError);
      } else {
        // Save file URL to candidate
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);
        await supabase
          .from('candidates')
          .update({ cv_file_url: urlData.publicUrl })
          .eq('id', candidate.id);
      }

      // Extract text client-side using pdf.js would be ideal, but for now
      // we'll prompt the user to paste text or use a simple extraction
      // For now: read as text (works for text-based PDFs)
      const text = await file.text();
      
      // Basic check if it's readable text
      const readableChars = text.replace(/[^\x20-\x7E\xC0-\xFF]/g, '').length;
      const ratio = readableChars / Math.max(text.length, 1);
      
      if (ratio > 0.3 && readableChars > 100) {
        // Decent text extraction
        const cleaned = text
          .replace(/[^\x20-\x7E\xC0-\xFF\n]/g, ' ')
          .replace(/\s{3,}/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        setCvText(cleaned);
        toast.success('Tekst uit PDF geëxtraheerd');
      } else {
        toast.info('PDF bevat waarschijnlijk gescande afbeeldingen. Plak de CV-tekst handmatig hieronder.');
      }
    } catch (err: any) {
      toast.error('Fout bij het lezen van de PDF');
      console.error(err);
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Trigger AI analysis
  const analyzeMutation = useMutation({
    mutationFn: async () => {
      if (!cvText || cvText.trim().length < 50) {
        throw new Error('CV tekst is te kort (minimaal 50 tekens)');
      }

      const { data, error } = await supabase.functions.invoke('analyze-cv', {
        body: { cv_text: cvText, candidate_id: candidate.id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      setCandidate((prev: any) => ({ ...prev, ai_status: 'analyzing' }));
      toast.success('Analyse gestart — resultaat verschijnt automatisch');
    },
    onError: (e: any) => {
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
              <p className="font-medium text-sm">CV wordt geanalyseerd...</p>
              <p className="text-xs text-muted-foreground">Dit duurt 1-3 minuten. Het resultaat verschijnt automatisch.</p>
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
              <p className="text-xs text-muted-foreground">Probeer het opnieuw of pas de CV-tekst aan.</p>
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
                onClick={() => analyzeMutation.mutate()}
                disabled={isAnalyzing}
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
            <h3 className="font-medium text-sm">CV Tekst</h3>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
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
              PDF uploaden
            </Button>
          </div>
        </div>

        <Textarea
          value={cvText}
          onChange={(e) => setCvText(e.target.value)}
          placeholder="Plak hier de CV-tekst van de kandidaat, of upload een PDF hierboven..."
          className="min-h-[200px] font-mono text-xs leading-relaxed"
          disabled={isAnalyzing}
        />

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {cvText.length > 0 ? `${cvText.length} tekens` : 'Nog geen tekst'}
            {cvText.length > 0 && cvText.length < 50 && ' — minimaal 50 tekens nodig'}
          </p>
          <Button
            onClick={() => analyzeMutation.mutate()}
            disabled={isAnalyzing || cvText.trim().length < 50}
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
                AI Analyse starten
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
                const certs: string[] = analysis?.competenties?.certificaten || [];
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
