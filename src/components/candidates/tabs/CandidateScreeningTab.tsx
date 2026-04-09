import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, ClipboardCheck, Star, User, Briefcase } from 'lucide-react';
import { toast } from 'sonner';

const PERSONAL_QUESTIONS = [
  { key: 'woonsituatie', label: 'Woonsituatie stabiel?' },
  { key: 'familiesituatie', label: 'Familiesituatie (partner/kinderen in NL of buitenland)?' },
  { key: 'werkervaring_nl', label: 'Ervaring met werken in Nederland?' },
  { key: 'reisbereidheid', label: 'Reisbereidheid?' },
  { key: 'beschikbaarheid', label: 'Beschikbaarheid / opzegtermijn?' },
  { key: 'taalvaardigheid', label: 'Taalvaardigheid?' },
  { key: 'motivatie', label: 'Motivatie om in NL te werken?' },
] as const;

const PROFESSIONAL_RATINGS = [
  { value: 'niet_beoordeeld', label: 'Niet beoordeeld' },
  { value: 'onvoldoende', label: 'Onvoldoende' },
  { value: 'voldoende', label: 'Voldoende' },
  { value: 'goed', label: 'Goed' },
  { value: 'uitstekend', label: 'Uitstekend' },
];

const RISK_LEVELS = [
  { value: 'niet_beoordeeld', label: 'Niet beoordeeld' },
  { value: 'hoog_risico', label: 'Hoog risico' },
  { value: 'gemiddeld', label: 'Gemiddeld' },
  { value: 'laag_risico', label: 'Laag risico' },
];

const RESULT_OPTIONS = [
  { value: 'niet_gescreend', label: 'Niet gescreend' },
  { value: 'afgekeurd', label: 'Afgekeurd' },
  { value: 'goedgekeurd', label: 'Goedgekeurd' },
];

interface ScreeningData {
  professional: {
    rating: string;
    questions_asked: string[];
    notes: string;
    skill_ratings: Record<string, number>;
  };
  personal: {
    risk_level: string;
    checklist: Record<string, { asked: boolean; notes: string }>;
    notes: string;
  };
  result: string;
  summary: string;
}

const getInitialData = (candidate: any): ScreeningData => {
  const existing = candidate.screening_data as ScreeningData | null;
  if (existing && existing.professional) return existing;

  const checklist: Record<string, { asked: boolean; notes: string }> = {};
  PERSONAL_QUESTIONS.forEach((q) => {
    checklist[q.key] = { asked: false, notes: '' };
  });

  return {
    professional: {
      rating: 'niet_beoordeeld',
      questions_asked: [],
      notes: '',
      skill_ratings: {},
    },
    personal: {
      risk_level: 'niet_beoordeeld',
      checklist,
      notes: '',
    },
    result: 'niet_gescreend',
    summary: '',
  };
};

const StarRating = ({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) => (
  <div className="flex gap-0.5">
    {[1, 2, 3, 4, 5].map((star) => (
      <button
        key={star}
        type="button"
        onClick={() => onChange(star === value ? 0 : star)}
        className="p-0.5 hover:scale-110 transition-transform"
      >
        <Star
          className={`h-4 w-4 ${
            star <= value
              ? 'fill-yellow-400 text-yellow-400'
              : 'text-muted-foreground/30'
          }`}
        />
      </button>
    ))}
  </div>
);

const CandidateScreeningTab = ({
  candidate,
  onUpdate,
}: {
  candidate: any;
  onUpdate: () => void;
}) => {
  const { user } = useAuth();
  const [data, setData] = useState<ScreeningData>(() => getInitialData(candidate));
  const [saving, setSaving] = useState(false);

  const interviewQuestions: string[] = candidate.ai_interview_questions ?? [];
  const riskFactors: string[] = candidate.ai_risk_factors ?? [];
  const skills: string[] = candidate.skills ?? [];

  // Helpers to update nested state
  const setProfessional = (patch: Partial<ScreeningData['professional']>) =>
    setData((d) => ({ ...d, professional: { ...d.professional, ...patch } }));

  const setPersonal = (patch: Partial<ScreeningData['personal']>) =>
    setData((d) => ({ ...d, personal: { ...d.personal, ...patch } }));

  const toggleQuestion = (q: string) => {
    const asked = data.professional.questions_asked;
    const next = asked.includes(q) ? asked.filter((x) => x !== q) : [...asked, q];
    setProfessional({ questions_asked: next });
  };

  const setSkillRating = (skill: string, rating: number) => {
    setProfessional({
      skill_ratings: { ...data.professional.skill_ratings, [skill]: rating },
    });
  };

  const setChecklistField = (key: string, field: 'asked' | 'notes', value: any) => {
    setPersonal({
      checklist: {
        ...data.personal.checklist,
        [key]: { ...data.personal.checklist[key], [field]: value },
      },
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: any = {
        screening_data: data as any,
        screened_at: new Date().toISOString(),
        screened_by: user?.id,
      };

      // Only update status on FIRST completion (not on re-saves)
      const isFirstCompletion = !candidate.screened_at;
      if (isFirstCompletion) {
        if (data.result === 'goedgekeurd') {
          updates.status = 'werkzoekend';
        } else if (data.result === 'afgekeurd') {
          updates.status = 'uitgeschreven';
        }
      }

      const { error } = await supabase
        .from('candidates')
        .update(updates)
        .eq('id', candidate.id);

      if (error) throw error;

      toast.success('Screening opgeslagen');
      onUpdate();
    } catch (e: any) {
      toast.error(e.message || 'Fout bij opslaan');
    } finally {
      setSaving(false);
    }
  };

  const isComplete = candidate.screened_at != null;

  return (
    <div className="space-y-6">
      {/* Section A: Vakinhoudelijke Screening */}
      <Card className="p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Vakinhoudelijke Screening</h3>
        </div>

        {/* AI classification & function group */}
        {(candidate.ai_classification || candidate.ai_function_group) && (
          <div className="flex gap-2 flex-wrap">
            {candidate.ai_classification && (
              <Badge variant="secondary">{candidate.ai_classification}</Badge>
            )}
            {candidate.ai_function_group && (
              <Badge variant="outline">{candidate.ai_function_group}</Badge>
            )}
          </div>
        )}

        {/* Interview questions checklist */}
        {interviewQuestions.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              AI Interviewvragen
            </Label>
            <div className="space-y-2">
              {interviewQuestions.map((q, i) => (
                <label
                  key={i}
                  className="flex items-start gap-2 p-2 rounded-md border bg-background hover:bg-accent/50 cursor-pointer"
                >
                  <Checkbox
                    checked={data.professional.questions_asked.includes(q)}
                    onCheckedChange={() => toggleQuestion(q)}
                    className="mt-0.5"
                  />
                  <span className="text-sm">{q}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Skill ratings */}
        {skills.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Vaardigheden beoordeling
            </Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {skills.map((skill) => (
                <div
                  key={skill}
                  className="flex items-center justify-between p-2 rounded-md border bg-background"
                >
                  <span className="text-sm font-medium">{skill}</span>
                  <StarRating
                    value={data.professional.skill_ratings[skill] ?? 0}
                    onChange={(v) => setSkillRating(skill, v)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Professional rating */}
        <div className="space-y-1.5">
          <Label>Professionele beoordeling</Label>
          <Select
            value={data.professional.rating}
            onValueChange={(v) => setProfessional({ rating: v })}
          >
            <SelectTrigger className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROFESSIONAL_RATINGS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label>Notities vakinhoudelijk</Label>
          <Textarea
            value={data.professional.notes}
            onChange={(e) => setProfessional({ notes: e.target.value })}
            placeholder="Opmerkingen over vakkennis, ervaring, etc."
            className="min-h-[80px]"
          />
        </div>
      </Card>

      {/* Section B: Persoonlijke Screening */}
      <Card className="p-5 space-y-5">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Persoonlijke Screening</h3>
        </div>

        {/* Risk factors */}
        {riskFactors.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              AI Risicofactoren
            </Label>
            <div className="flex gap-2 flex-wrap">
              {riskFactors.map((factor, i) => (
                <Badge
                  key={i}
                  variant="secondary"
                  className="bg-amber-100 text-amber-800 border-0"
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {factor}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Structured questions */}
        <div className="space-y-3">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">
            Persoonlijke vragen
          </Label>
          {PERSONAL_QUESTIONS.map((q) => {
            const item = data.personal.checklist[q.key] ?? { asked: false, notes: '' };
            return (
              <div key={q.key} className="p-3 rounded-md border bg-background space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={item.asked}
                    onCheckedChange={(checked) =>
                      setChecklistField(q.key, 'asked', !!checked)
                    }
                  />
                  <span className="text-sm font-medium">{q.label}</span>
                  {item.asked && (
                    <Badge variant="secondary" className="bg-stat-green/10 text-stat-green border-0 text-xs ml-auto">
                      Gevraagd
                    </Badge>
                  )}
                </label>
                <Textarea
                  value={item.notes}
                  onChange={(e) =>
                    setChecklistField(q.key, 'notes', e.target.value)
                  }
                  placeholder="Notities..."
                  className="min-h-[40px] text-sm"
                />
              </div>
            );
          })}
        </div>

        {/* Risk level */}
        <div className="space-y-1.5">
          <Label>Risiconiveau</Label>
          <Select
            value={data.personal.risk_level}
            onValueChange={(v) => setPersonal({ risk_level: v })}
          >
            <SelectTrigger className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RISK_LEVELS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label>Notities persoonlijk</Label>
          <Textarea
            value={data.personal.notes}
            onChange={(e) => setPersonal({ notes: e.target.value })}
            placeholder="Opmerkingen over persoonlijke situatie..."
            className="min-h-[80px]"
          />
        </div>
      </Card>

      {/* Section C: Samenvatting */}
      <Card className="p-5 space-y-5">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Samenvatting</h3>
        </div>

        <div className="space-y-1.5">
          <Label>Eindresultaat</Label>
          <Select
            value={data.result}
            onValueChange={(v) => setData((d) => ({ ...d, result: v }))}
          >
            <SelectTrigger className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESULT_OPTIONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Samenvatting</Label>
          <Textarea
            value={data.summary}
            onChange={(e) => setData((d) => ({ ...d, summary: e.target.value }))}
            placeholder="Korte samenvatting van de screening..."
            className="min-h-[100px]"
          />
        </div>

        {isComplete && (
          <p className="text-xs text-muted-foreground">
            Eerder gescreend op{' '}
            {new Date(candidate.screened_at).toLocaleString('nl-NL', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}

        <Button
          onClick={handleSave}
          disabled={saving || data.result === 'niet_gescreend'}
          className="gap-2"
        >
          <ClipboardCheck className="h-4 w-4" />
          {saving ? 'Opslaan...' : 'Screening afronden'}
        </Button>

        {data.result === 'niet_gescreend' && (
          <p className="text-xs text-muted-foreground">
            Selecteer een eindresultaat (goedgekeurd of afgekeurd) om de screening af te ronden.
          </p>
        )}
      </Card>
    </div>
  );
};

export default CandidateScreeningTab;
