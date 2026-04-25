import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDate, formatEUR } from '@/lib/format';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

type UnitStatus = Database['public']['Enums']['unit_status'];

const statusBadge: Record<string, string> = {
  beschikbaar: 'bg-stat-green/10 text-stat-green border-0',
  gereserveerd: 'bg-blue-100 text-blue-600 border-0',
  bezet: 'bg-red-100 text-red-600 border-0',
  onderhoud: 'bg-orange-100 text-orange-600 border-0',
  geblokkeerd: 'bg-muted text-muted-foreground border-0',
};

const UnitsTab = ({ property }: { property: any }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', capacity: '1', floor: '', weekly_cost: '', status: 'beschikbaar' as UnitStatus, notes: '',
  });

  const addUnit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('units').insert({
        organization_id: orgId,
        property_id: property.id,
        name: form.name,
        capacity: Number(form.capacity) || 1,
        floor: form.floor ? Number(form.floor) : null,
        weekly_cost: form.weekly_cost ? Number(form.weekly_cost) : null,
        status: form.status,
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property', property.id] });
      setAdding(false);
      setForm({ name: '', capacity: '1', floor: '', weekly_cost: '', status: 'beschikbaar', notes: '' });
      toast.success('Kamer aangemaakt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const units = property.units ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Kamers ({units.length})</h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Nieuwe kamer
        </Button>
      </div>

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Nieuwe kamer</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Kamernaam *</Label><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Capaciteit</Label><Input type="number" value={form.capacity} onChange={(e) => setForm(f => ({ ...f, capacity: e.target.value }))} /></div>
              <div><Label>Verdieping</Label><Input type="number" value={form.floor} onChange={(e) => setForm(f => ({ ...f, floor: e.target.value }))} /></div>
            </div>
            <div><Label>Weekprijs (€)</Label><Input type="number" value={form.weekly_cost} onChange={(e) => setForm(f => ({ ...f, weekly_cost: e.target.value }))} className="max-w-xs" /></div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm(f => ({ ...f, status: v as UnitStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="beschikbaar">Beschikbaar</SelectItem>
                  <SelectItem value="gereserveerd">Gereserveerd</SelectItem>
                  <SelectItem value="bezet">Bezet</SelectItem>
                  <SelectItem value="onderhoud">Onderhoud</SelectItem>
                  <SelectItem value="geblokkeerd">Geblokkeerd</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setAdding(false)}>Annuleren</Button>
              <Button onClick={() => addUnit.mutate()} disabled={!form.name || addUnit.isPending}>
                {addUnit.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {units.map((u: any) => {
          const assignments = u.housing_assignments ?? [];
          const occupants = assignments.filter((a: any) => a.status === 'ingecheckt');
          const occupied = occupants.length;
          const isExpanded = expandedUnit === u.id;

          return (
            <div key={u.id} className="bg-card rounded-lg border">
              <button
                onClick={() => setExpandedUnit(isExpanded ? null : u.id)}
                className="w-full text-left p-4 flex items-start justify-between"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-sm">{u.name}</p>
                    <Badge variant="secondary" className={`text-xs ${statusBadge[u.status] ?? ''}`}>{u.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{occupied}/{u.capacity} bezet</p>
                  {u.weekly_cost && <p className="text-xs text-muted-foreground">{formatEUR(u.weekly_cost)}/week</p>}
                  {u.floor != null && <p className="text-xs text-muted-foreground">Verdieping {u.floor}</p>}
                  {occupants.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {occupants.map((a: any) => (
                        <p key={a.id} className="text-xs">
                          {a.candidates?.first_name} {a.candidates?.last_name}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
              </button>

              {isExpanded && (
                <div className="border-t px-4 py-3 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase">Toewijzingshistorie</p>
                  {assignments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Geen toewijzingen</p>
                  ) : (
                    assignments.map((a: any) => (
                      <div key={a.id} className="text-xs flex items-center justify-between">
                        <span>{a.candidates?.first_name} {a.candidates?.last_name}</span>
                        <span className="text-muted-foreground">
                          {formatDate(a.check_in_date)} — {a.check_out_date ? formatDate(a.check_out_date) : 'heden'}
                          {' '}
                          <Badge variant="secondary" className={`text-[10px] ${a.status === 'ingecheckt' ? 'bg-stat-green/10 text-stat-green border-0' : a.status === 'gereserveerd' ? 'bg-blue-100 text-blue-700 border-0' : 'bg-muted text-muted-foreground border-0'}`}>
                            {a.status}
                          </Badge>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {units.length === 0 && <p className="text-center text-muted-foreground py-8">Nog geen kamers. Voeg een kamer toe.</p>}
    </div>
  );
};

export default UnitsTab;
