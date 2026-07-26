import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Save, RotateCcw, Users, Eraser } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';
import { stripMarkdownInline, looksLikeMarkdown } from '@/lib/rich-text';
import VacancyTextGeneratorDialog from '@/components/vacancies/VacancyTextGeneratorDialog';

interface Props {
  vacancy: any;
  canEdit: boolean;
}

/**
 * De omschrijving die de KANDIDAAT ziet — in zijn portaal en in het voorstel als hij
 * gematcht wordt. Bewust los van `description` (interne korte notitie van de recruiter)
 * en los van de SEO-websitetekst: dit is de enige tekst die richting de kandidaat gaat.
 */
const VacancyCandidateDescriptionCard = ({ vacancy, canEdit }: Props) => {
  const qc = useQueryClient();
  const saved = (vacancy.candidate_description ?? '') as string;
  const [text, setText] = useState(saved);
  const [generatorOpen, setGeneratorOpen] = useState(false);

  useEffect(() => { setText(saved); }, [saved]);

  const dirty = text !== saved;
  const hasMarkdown = looksLikeMarkdown(text);

  const save = useMutation({
    mutationFn: async () => {
      const clean = stripMarkdownInline(text);
      await unwrap(
        supabase.from('vacancies').update({ candidate_description: clean || null } as any).eq('id', vacancy.id),
      );
      return clean;
    },
    onSuccess: (clean) => {
      setText(clean);
      qc.invalidateQueries({ queryKey: ['vacancy', vacancy.id] });
      toast.success('Omschrijving voor kandidaten opgeslagen');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Omschrijving voor kandidaten
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Dit is wat de kandidaat ziet in zijn portaal en in het voorstel. Gewone tekst, geen opmaakcodes.
            </p>
          </div>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setGeneratorOpen(true)} className="gap-1.5 shrink-0">
              <Sparkles className="h-3.5 w-3.5" /> {saved ? 'Opnieuw laten schrijven' : 'Laat AI schrijven'}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {saved || canEdit ? (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              readOnly={!canEdit}
              rows={10}
              className="text-sm leading-relaxed"
              placeholder="Nog geen omschrijving. Laat AI er één schrijven op basis van de vacaturegegevens, of typ zelf."
            />
          ) : (
            <p className="text-sm text-muted-foreground">Nog geen omschrijving voor kandidaten.</p>
          )}

          {hasMarkdown && (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <span className="flex-1">
                Er staan opmaakcodes in deze tekst (zoals # of **). Kandidaten zien die letterlijk.
              </span>
              <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setText(stripMarkdownInline(text))}>
                <Eraser className="h-3 w-3" /> Opschonen
              </Button>
            </div>
          )}

          {canEdit && dirty && (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setText(saved)} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" /> Herstellen
              </Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} className="gap-1.5">
                <Save className="h-3.5 w-3.5" /> {save.isPending ? 'Opslaan…' : 'Opslaan'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <VacancyTextGeneratorDialog open={generatorOpen} onOpenChange={setGeneratorOpen} vacancy={vacancy} />
    </>
  );
};

export default VacancyCandidateDescriptionCard;
