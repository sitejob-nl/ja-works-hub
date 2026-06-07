import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Brain,
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  Clock,
  ArrowDownToLine,
  Share2,
  ChevronDown,
  Server,
  Cloud,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import AiAnalysisCard from '@/components/AiAnalysisCard';
import AiAnalysisShareDialog from '@/components/candidates/AiAnalysisShareDialog';
import { logAudit } from '@/lib/audit';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

const formatEuro = (cents: number) =>
  (cents / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });

const extractFunctionErrorMessage = async (error: unknown) => {
  const fallback = error instanceof Error ? error.message : 'Kon analyse niet starten';
  const context = (error as { context?: unknown })?.context;

  let payload: unknown = null;
  if (context instanceof Response) {
    const text = await context.clone().text().catch(() => '');
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }
  } else if (context && typeof context === 'object' && 'body' in context) {
    payload = (context as { body?: unknown }).body;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = { error: payload };
      }
    }
  }

  if (payload && typeof payload === 'object') {
    const body = payload as { error?: unknown; details?: unknown; message?: unknown };
    const message = body.error ?? body.message;
    if (typeof message === 'string' && message.trim()) {
      const details = typeof body.details === 'string' && body.details.trim()
        ? ` (${body.details.trim().slice(0, 180)})`
        : '';
      return `${message}${details}`;
    }
  }

  return fallback;
};

const CV_ACCEPT = [
  '.pdf',
  '.doc',
  '.docx',
  '.odt',
  '.txt',
  '.rtf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.tif',
  '.tiff',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'text/plain',
  'text/rtf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
].join(',');

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

  const extractPdfText = async (file: File) => {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .filter(Boolean)
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (pageText) pages.push(pageText);
    }

    const text = pages.join('\n\n').trim();
    if (text.length > 100) return text;

    toast.info('Geen tekstlaag gevonden. OCR wordt gestart; dit kan even duren.');
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    const ocrPages: string[] = [];

    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);

        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const result = await worker.recognize(canvas);
        const pageText = result.data.text.replace(/\s{3,}/g, '\n').trim();
        if (pageText) ocrPages.push(pageText);
      }
    } finally {
      await worker.terminate();
    }

    return ocrPages.join('\n\n').trim();
  };

  const extractDocxText = async (file: File) => {
    const { unzipSync, strFromU8 } = await import('fflate');
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const documentParts = Object.keys(zip)
      .filter((path) => /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(path))
      .sort((a, b) => {
        if (a === 'word/document.xml') return -1;
        if (b === 'word/document.xml') return 1;
        return a.localeCompare(b);
      });

    const parser = new DOMParser();
    const sections: string[] = [];

    for (const part of documentParts) {
      const xml = strFromU8(zip[part]);
      const doc = parser.parseFromString(xml, 'application/xml');
      const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
      const text = paragraphs
        .map((paragraph) => Array.from(paragraph.getElementsByTagName('w:t'))
          .map((node) => node.textContent ?? '')
          .join('')
          .trim())
        .filter(Boolean)
        .join('\n');
      if (text) sections.push(text);
    }

    return sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  const extractOdtText = async (file: File) => {
    const { unzipSync, strFromU8 } = await import('fflate');
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const content = zip['content.xml'];
    if (!content) return '';

    return strFromU8(content)
      .replace(/<text:line-break\s*\/>/g, '\n')
      .replace(/<\/text:(p|h)>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[^\S\r\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const extractLegacyDocText = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const utf16 = new TextDecoder('utf-16le', { fatal: false }).decode(bytes);
    const clean = (value: string) => value
      .replace(/[^\S\r\n]+/g, ' ')
      .replace(/[^\p{L}\p{N}\p{P}\p{Zs}\r\n@+/-]/gu, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const candidates = [clean(utf8), clean(utf16)].sort((a, b) => b.length - a.length);
    return candidates[0] ?? '';
  };

  const extractRtfText = async (file: File) => {
    const value = await file.text();
    return value
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
      .replace(/\\[a-zA-Z]+\d* ?/g, '')
      .replace(/[{}]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const extractImageText = async (file: File) => {
    toast.info('OCR wordt gestart voor de afbeelding; dit kan even duren.');
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    try {
      const result = await worker.recognize(file);
      return result.data.text.replace(/\s{3,}/g, '\n').trim();
    } finally {
      await worker.terminate();
    }
  };

  const extractCvTextFromFile = async (file: File) => {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();

    if (type === 'application/pdf' || name.endsWith('.pdf')) return extractPdfText(file);
    if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) return extractDocxText(file);
    if (type === 'application/vnd.oasis.opendocument.text' || name.endsWith('.odt')) return extractOdtText(file);
    if (type === 'application/msword' || name.endsWith('.doc')) return extractLegacyDocText(file);
    if (type === 'text/plain' || name.endsWith('.txt')) return file.text();
    if (type === 'text/rtf' || name.endsWith('.rtf')) return extractRtfText(file);
    if (type.startsWith('image/') || /\.(jpe?g|png|webp|tiff?)$/i.test(name)) return extractImageText(file);

    throw new Error('Dit bestandstype wordt nog niet ondersteund voor AI-analyse');
  };

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

  // Org-default provider + saldo voor UI-keuzes
  const { data: orgSettings } = useQuery({
    queryKey: ['ai-provider-settings', candidate.organization_id],
    queryFn: async () => {
      const { data: org } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', candidate.organization_id)
        .single();
      const { data: credits } = await supabase
        .from('organization_credits')
        .select('balance_cents')
        .eq('organization_id', candidate.organization_id)
        .maybeSingle();
      const settings = (org?.settings as Record<string, unknown> | null) ?? {};
      return {
        defaultProvider: (settings.cv_ai_provider === 'cloud' ? 'cloud' : 'vps') as 'vps' | 'cloud',
        balanceCents: credits?.balance_cents ?? 0,
      };
    },
  });

  const defaultProvider = orgSettings?.defaultProvider ?? 'vps';
  const balanceCents = orgSettings?.balanceCents ?? 0;
  const cloudAvailable = balanceCents >= 25;

  // Trigger AI analysis (provider optioneel; null = org-default)
  const analyzeMutation = useMutation({
    mutationFn: async (provider: 'vps' | 'cloud' | null) => {
      if (!cvText || cvText.trim().length < 50) {
        throw new Error('CV tekst is te kort (minimaal 50 tekens)');
      }

      const body: Record<string, unknown> = {
        cv_text: cvText,
        candidate_id: candidate.id,
      };
      if (provider) body.provider = provider;

      const { data, error } = await supabase.functions.invoke('analyze-cv', { body });

      if (error) {
        throw new Error(await extractFunctionErrorMessage(error));
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ['ai-provider-settings', candidate.organization_id] });
      if (data?.status === 'completed') {
        // Cloud-pad — direct klaar; haal verse data op zodat UI ai_* velden ziet
        const { data: fresh } = await supabase
          .from('candidates')
          .select('*')
          .eq('id', candidate.id)
          .single();
        if (fresh) setCandidate(fresh);
        qc.invalidateQueries({ queryKey: ['candidate', candidate.id] });
        toast.success(
          `Analyse voltooid (Cloud, ${formatEuro(data.cost_cents ?? 0)} verbruikt)`,
        );
      } else {
        // VPS-pad — wachten op realtime callback
        setCandidate((prev: any) => ({ ...prev, ai_status: 'analyzing' }));
        toast.success('Analyse gestart — resultaat verschijnt automatisch (1-3 min)');
      }
    },
    onError: (e: Error & { balance_cents?: number }) => {
      // 402: Cloud-saldo onvoldoende
      if (e.message?.toLowerCase().includes('saldo')) {
        toast.error(
          `${e.message}. Kies VPS of vraag SiteJob om bijvullen.`,
        );
        qc.invalidateQueries({ queryKey: ['ai-provider-settings', candidate.organization_id] });
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
              <p className="text-xs text-muted-foreground">CV, profiel en interne notities worden meegenomen. Dit duurt 1-3 minuten.</p>
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={isAnalyzing} className="gap-1.5">
                    <Brain className="h-3.5 w-3.5" />
                    Opnieuw analyseren
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-xs">Provider</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => analyzeMutation.mutate(null)}>
                    <Brain className="h-4 w-4 mr-2" />
                    Standaard ({defaultProvider === 'cloud' ? 'Cloud' : 'VPS'})
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => analyzeMutation.mutate('vps')}>
                    <Server className="h-4 w-4 mr-2" />
                    VPS (gratis, 1-3 min)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => analyzeMutation.mutate('cloud')}
                    disabled={!cloudAvailable}
                  >
                    <Cloud className="h-4 w-4 mr-2" />
                    Cloud (~10s, {formatEuro(balanceCents)})
                    {!cloudAvailable && (
                      <span className="ml-auto text-[10px] text-muted-foreground">saldo op</span>
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
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
                    AI analyse starten
                    <ChevronDown className="h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs">
                Standaard: {defaultProvider === 'cloud' ? 'Cloud' : 'VPS'}
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => analyzeMutation.mutate(null)}>
                <Brain className="h-4 w-4 mr-2" />
                Analyse starten (standaard)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => analyzeMutation.mutate('vps')}>
                <Server className="h-4 w-4 mr-2" />
                <div className="flex-1">
                  <div className="text-sm">VPS</div>
                  <div className="text-[10px] text-muted-foreground">gratis, 1-3 min</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => analyzeMutation.mutate('cloud')}
                disabled={!cloudAvailable}
              >
                <Cloud className="h-4 w-4 mr-2" />
                <div className="flex-1">
                  <div className="text-sm">Cloud</div>
                  <div className="text-[10px] text-muted-foreground">
                    ~10 sec — saldo {formatEuro(balanceCents)}
                  </div>
                </div>
                {!cloudAvailable && (
                  <span className="text-[10px] text-orange-600 ml-2">op</span>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
