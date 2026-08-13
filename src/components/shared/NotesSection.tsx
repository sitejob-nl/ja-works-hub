import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrapDeleted } from '@/lib/db';
import { toFriendlyError } from '@/lib/errorMessages';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Plus, Pencil, Trash2, Lock } from 'lucide-react';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { toast } from 'sonner';

type EntityType = 'kandidaat' | 'opdrachtgever' | 'vacature' | 'plaatsing';

// De importer trimt elk segment apart, dus alleen een witruimte-loze vergelijking
// laat de opgeknipte notitierijen weer op de oorspronkelijke blob aansluiten.
const squash = (s?: string | null) => (s ?? '').replace(/\s+/g, '');

interface NotesSectionProps {
  entityId: string;
  entityType: EntityType;
  pinnedNotes?: Array<{
    id: string;
    title: string;
    body: string;
    sourceLabel?: string;
    /** Alleen aanzetten voor een bron die dezelfde tekst kán bevatten als de notitierijen
     *  (candidates.notes vs. de Carerix-import). Zonder deze vlag wordt er niets verborgen. */
    dedupeAgainstNotes?: boolean;
  }>;
}

const NotesSection = ({ entityId, entityType, pinnedNotes = [] }: NotesSectionProps) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ body: '', is_internal: true });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const { data: notes = [] } = useQuery({
    queryKey: ['notes', entityType, entityId],
    queryFn: async () => {
      const { data: rawNotes, error } = await supabase
        .from('notes')
        .select('*')
        .eq('related_entity_id', entityId)
        .eq('related_entity_type', entityType)
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (!rawNotes || rawNotes.length === 0) return [];

      const uniqueIds = Array.from(
        new Set(rawNotes.map((n: any) => n.created_by).filter(Boolean))
      );

      let profilesById: Record<string, { id: string; full_name: string | null }> = {};
      if (uniqueIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', uniqueIds as string[]);
        if (profilesError) throw profilesError;
        profilesById = Object.fromEntries(
          (profilesData ?? []).map((p: any) => [p.id, p])
        );
      }

      const noteIds = rawNotes.map((n: any) => n.id).filter(Boolean);
      let carerixNoteIds = new Set<string>();
      if (noteIds.length > 0) {
        const { data: mappingsData, error: mappingsError } = await supabase
          .from('external_mappings')
          .select('entity_id')
          .eq('organization_id', orgId)
          .eq('external_system', 'carerix')
          .eq('entity_type', 'note')
          .in('entity_id', noteIds as string[]);
        if (mappingsError) throw mappingsError;
        carerixNoteIds = new Set(
          (mappingsData ?? []).map((mapping: any) => mapping.entity_id)
        );
      }

      return rawNotes.map((n: any) => {
        const profile = n.created_by && profilesById[n.created_by]
          ? { full_name: profilesById[n.created_by].full_name }
          : null;
        const createdByDisplayName = carerixNoteIds.has(n.id)
          ? 'Carerix'
          : profile?.full_name;

        return {
          ...n,
          profiles: profile,
          created_by_display_name: createdByDisplayName,
        };
      });
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('notes').insert({
        body: form.body,
        is_internal: form.is_internal,
        related_entity_id: entityId,
        related_entity_type: entityType,
        created_by: user!.id,
        organization_id: orgId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', entityType, entityId] });
      setAdding(false);
      setForm({ body: '', is_internal: true });
      toast.success('Notitie toegevoegd');
    },
    onError: (e: any) => toast.error(toFriendlyError(e)),
  });

  const update = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      // Een door RLS geblokkeerde update geeft geen error maar een lege set terug:
      // zonder deze rijentelling meldde de UI 'bijgewerkt' terwijl er niets veranderde.
      const { data, error } = await supabase
        .from('notes')
        .update({ body, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Bijwerken niet toegestaan — je kunt alleen je eigen notities aanpassen.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', entityType, entityId] });
      setEditingId(null);
      toast.success('Notitie bijgewerkt');
    },
    onError: (e: any) => toast.error(toFriendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      // unwrapDeleted zet zelf .select('id') en throwt bij 0 geraakte rijen — anders
      // meldt de UI 'verwijderd' terwijl RLS de delete stil heeft tegengehouden.
      await unwrapDeleted(
        supabase.from('notes').delete().eq('id', id),
        'Verwijderen niet toegestaan — je kunt alleen je eigen notities verwijderen.',
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', entityType, entityId] });
      toast.success('Notitie verwijderd');
    },
    onError: (e: any) => toast.error(toFriendlyError(e)),
  });

  // Carerix schrijft dezelfde vrije tekst twee keer weg: als hele blob in
  // candidates.notes (die hier als vastgepinde kaart binnenkomt) én opgeknipt per
  // [XX dd-mm-jjjj uu:mm]-marker als losse notitierijen. Zonder dit filter staat
  // vrijwel elk geïmporteerd dossier dubbel op het scherm. We verbergen daarom de
  // stukken van de pinned kaart die al als notitierij bestaan; is er niets
  // gedekt (of zijn er geen notitierijen), dan verandert er niets.
  const squashedNotes = useMemo(() => notes.map((n: any) => squash(n.body)).filter(Boolean), [notes]);

  // De query sorteert created_at DESC; de importer knipte de blob chronologisch op, dus
  // alleen de omgekeerde volgorde levert een aaneenschakeling die op de naden aansluit.
  const notesBlob = useMemo(() => [...squashedNotes].reverse().join(''), [squashedNotes]);

  const visiblePinnedNotes = useMemo(() => {
    if (!notesBlob) return pinnedNotes;
    return pinnedNotes
      .map((note) => {
        if (!note.dedupeAgainstNotes) return note;
        const segments = (note.body ?? '')
          .split(/\n\s*\n/)
          .map((segment) => segment.trim())
          .filter(Boolean);
        const remaining = segments.filter((segment) => {
          const needle = squash(segment);
          // Ondergrens: hele korte zinnetjes ("nog niet besproken") komen toevallig in een
          // notitierij voor en zouden dan onterecht uit beeld verdwijnen.
          if (needle.length < 25) return true;
          // Twee toetsen: per losse notitierij (volgorde-onafhankelijk — de markerdatums
          // staan niet altijd chronologisch in de blob) én tegen de aaneenschakeling, voor
          // segmenten die over de naad van twee rijen heen lopen.
          if (squashedNotes.some((body) => body.includes(needle))) return false;
          return !notesBlob.includes(needle);
        });
        return { ...note, body: remaining.join('\n\n') };
      })
      .filter((note) => note.body.length > 0);
  }, [pinnedNotes, notesBlob, squashedNotes]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Notities</h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1">
          <Plus className="h-3.5 w-3.5" />Nieuwe notitie
        </Button>
      </div>

      {adding && (
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <Textarea
            value={form.body}
            onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))}
            rows={3}
            placeholder="Schrijf een notitie..."
          />
          <div className="flex items-center gap-2">
            <Switch
              checked={form.is_internal}
              onCheckedChange={(v) => setForm(f => ({ ...f, is_internal: v }))}
              id="intern"
            />
            <Label htmlFor="intern">Intern (niet zichtbaar voor medewerker)</Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setForm({ body: '', is_internal: true }); }}>Annuleren</Button>
            <Button size="sm" onClick={() => add.mutate()} disabled={!form.body.trim() || add.isPending}>Opslaan</Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {visiblePinnedNotes.map((note) => (
          <div key={note.id} className="bg-muted/30 rounded-lg border p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium">{note.title}</span>
              <Badge variant="secondary" className="text-[10px]">
                {note.sourceLabel ?? 'Profiel'}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note.body}</p>
          </div>
        ))}
        {notes.map((note: any) => {
          const isOwn = note.created_by === user?.id;

          if (editingId === note.id) {
            return (
              <div key={note.id} className="bg-card rounded-lg border p-4 space-y-3">
                <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={3} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Annuleren</Button>
                  <Button size="sm" onClick={() => update.mutate({ id: note.id, body: editBody })} disabled={!editBody.trim()}>Opslaan</Button>
                </div>
              </div>
            );
          }

          return (
            <div key={note.id} className="bg-card rounded-lg border p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{note.created_by_display_name ?? 'Onbekend'}</span>
                  <span className="text-xs text-muted-foreground" title={formatRelativeTime(note.created_at)}>
                    {formatDateTime(note.created_at)}
                  </span>
                  {note.is_internal && (
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <Lock className="h-2.5 w-2.5" />Intern
                    </Badge>
                  )}
                </div>
                {isOwn && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingId(note.id); setEditBody(note.body); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => remove.mutate(note.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note.body}</p>
            </div>
          );
        })}
        {notes.length === 0 && visiblePinnedNotes.length === 0 && !adding && (
          <p className="text-center text-muted-foreground py-8">Nog geen notities</p>
        )}
      </div>
    </div>
  );
};

export default NotesSection;
