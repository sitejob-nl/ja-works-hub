import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, FileText, Loader2, ShieldAlert } from 'lucide-react';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { formatDate } from '@/lib/format';

type RegulationData = {
  regulation: { title: string; version: number; content: string; file_url: string | null };
  context_type: string | null;
  first_name: string | null;
  organization: { name: string | null; logo_url: string | null };
  already_signed_at: string | null;
};

const CONTEXT_INTRO: Record<string, string> = {
  voertuig: 'Je hebt een bedrijfsauto toegewezen gekregen. Lees de regels voor het gebruik door en bevestig onderaan.',
  huisvesting: 'Je hebt een kamer toegewezen gekregen. Lees de huisregels door en bevestig onderaan.',
};

/**
 * Publieke acceptatiepagina voor een reglement (token uit de mail, geen login).
 *
 * Jeroen wil dat aantoonbaar is dát iemand het document gelezen heeft. Bij een PDF kun je niet
 * echt doorscrollen afdwingen, dus we renderen 'm pagina voor pagina met pdfjs en houden bij
 * welke pagina's in beeld zijn geweest. De bevestigknop gaat pas aan als de laatste pagina is
 * bereikt. Niet waterdicht, wel aantoonbaar méér dan een blind vinkje.
 */
const RegulationAccept = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<RegulationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [renderError, setRenderError] = useState(false);
  const canvasHost = useRef<HTMLDivElement | null>(null);
  const endMarker = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: res, error: err } = await supabase.functions.invoke('regulation-accept', {
        body: { token, action: 'view' },
      });
      if (cancelled) return;
      if (err || res?.error) {
        setError(res?.error ?? 'Deze link kon niet worden geopend.');
      } else {
        setData(res as RegulationData);
        setSignedAt(res?.already_signed_at ?? null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  // PDF pagina voor pagina renderen. Tekst-only reglementen slaan dit over.
  const renderPdf = useCallback(async (url: string) => {
    try {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const pdf = await pdfjsLib.getDocument({ url }).promise;
      setPageCount(pdf.numPages);
      const host = canvasHost.current;
      if (!host) return;
      host.innerHTML = '';
      for (let n = 1; n <= pdf.numPages; n += 1) {
        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: 1.4 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = 'w-full h-auto rounded border mb-3 bg-white';
        host.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        if (ctx) await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      }
    } catch {
      // Rendering mislukt (corrupt bestand, verlopen URL): laat de gebruiker niet vastlopen —
      // de PDF is ook als bijlage meegestuurd, dus we vallen terug op een gewone download.
      setRenderError(true);
      setReachedEnd(true);
    }
  }, []);

  useEffect(() => {
    if (data?.regulation.file_url) renderPdf(data.regulation.file_url);
    else if (data) setPageCount(0);
  }, [data, renderPdf]);

  // Onderaan-in-beeld = doorgelezen.
  useEffect(() => {
    const el = endMarker.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setReachedEnd(true); },
      { rootMargin: '0px 0px -40px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [data, pageCount]);

  const accept = async () => {
    setSubmitting(true);
    const { data: res, error: err } = await supabase.functions.invoke('regulation-accept', {
      body: { token, action: 'accept' },
    });
    setSubmitting(false);
    if (err || res?.error) {
      setError(res?.error ?? 'Bevestigen mislukt. Probeer het later opnieuw.');
      return;
    }
    setSignedAt(res?.signed_at ?? new Date().toISOString());
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-2">
            <ShieldAlert className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="font-medium">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const reg = data!.regulation;
  const orgName = data!.organization.name ?? 'JA Werkt';

  return (
    <div className="min-h-screen bg-muted/30 py-6 px-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-3">
          {data!.organization.logo_url
            ? <img src={data!.organization.logo_url} alt={orgName} className="h-9 w-auto" />
            : <span className="font-semibold">{orgName}</span>}
        </div>

        {signedAt ? (
          <Card>
            <CardContent className="pt-6 text-center space-y-2">
              <CheckCircle2 className="h-10 w-10 mx-auto text-stat-green" />
              <p className="font-medium">Bedankt, je bevestiging is vastgelegd.</p>
              <p className="text-sm text-muted-foreground">
                {reg.title} (versie {reg.version}) — bevestigd op {formatDate(signedAt)}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" /> {reg.title}
                  <span className="text-xs font-normal text-muted-foreground">versie {reg.version}</span>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {data!.first_name ? `Hoi ${data!.first_name}. ` : ''}
                  {CONTEXT_INTRO[data!.context_type ?? ''] ?? 'Lees het document door en bevestig onderaan.'}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {reg.content.trim() && (
                  <p className="whitespace-pre-wrap text-sm">{reg.content}</p>
                )}

                {reg.file_url && !renderError && (
                  <>
                    <div ref={canvasHost} />
                    {pageCount === 0 && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Document laden…
                      </div>
                    )}
                  </>
                )}

                {reg.file_url && renderError && (
                  <div className="rounded-md border bg-background p-3 text-sm">
                    <p className="text-muted-foreground">
                      Het document kan hier niet worden weergegeven. Open het via de knop hieronder
                      of gebruik de bijlage uit de e-mail.
                    </p>
                    <Button asChild variant="outline" size="sm" className="mt-2">
                      <a href={reg.file_url} target="_blank" rel="noopener noreferrer">Document openen</a>
                    </Button>
                  </div>
                )}

                <div ref={endMarker} />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5 space-y-3">
                {!reachedEnd && (
                  <p className="text-xs text-muted-foreground">
                    Scroll door tot het einde van het document om te kunnen bevestigen.
                  </p>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={agreed}
                    disabled={!reachedEnd}
                    onCheckedChange={(v) => setAgreed(v === true)}
                    className="mt-0.5"
                  />
                  <span className={!reachedEnd ? 'text-muted-foreground' : undefined}>
                    Ik heb {reg.title.toLowerCase()} gelezen en begrepen.
                  </span>
                </label>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button onClick={accept} disabled={!agreed || submitting} className="w-full">
                  {submitting ? 'Bezig…' : 'Bevestigen'}
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

export default RegulationAccept;
