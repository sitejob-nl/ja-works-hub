import { useEffect, useId, useState, type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Settings2, Save } from 'lucide-react';
import { clampNumber, DEFAULT_FUEL_CONDITIONS } from '@/lib/fuel-analysis';
import type { FuelAnalysisConditions } from '@/lib/fuel-analysis';

export const ConditionsTab = ({ conditions, onSave, saving }: {
  conditions: FuelAnalysisConditions;
  onSave: (next: FuelAnalysisConditions) => void;
  saving: boolean;
}) => {
  const [draft, setDraft] = useState<FuelAnalysisConditions>(conditions);

  useEffect(() => {
    setDraft(conditions);
  }, [conditions]);

  const setBool = (key: keyof FuelAnalysisConditions, value: boolean) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const setNumber = (key: keyof FuelAnalysisConditions, value: string, fallback: number, min: number, max: number) => {
    setDraft((current) => ({ ...current, [key]: clampNumber(value, fallback, min, max) }));
  };

  return (
    <Card>
      <CardContent className="pt-5 space-y-5">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <Settings2 className="h-4 w-4 text-stat-blue" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Analysevoorwaarden</h2>
            <p className="text-sm text-muted-foreground">
              Deze regels worden gebruikt bij nieuwe tankpasimports en blijven per organisatie bewaard.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ConditionRow
            title="Meerdere tankbeurten per dag"
            description="Markeer dezelfde tankpas of referentie wanneer die op één dag meerdere transacties heeft."
            enabled={draft.multiple_same_day_enabled}
            onEnabled={(v) => setBool('multiple_same_day_enabled', v)}
          />

          <ConditionRow
            title="Boven tankcapaciteit"
            description="Vergelijk liters met de voertuigspecifieke tankinhoud plus marge."
            enabled={draft.tank_capacity_enabled}
            onEnabled={(v) => setBool('tank_capacity_enabled', v)}
          >
            <NumberField
              label="Marge (%)"
              value={draft.tank_capacity_margin_pct}
              onChange={(value) => setNumber('tank_capacity_margin_pct', value, DEFAULT_FUEL_CONDITIONS.tank_capacity_margin_pct, 0, 100)}
            />
          </ConditionRow>

          <ConditionRow
            title="Verbruik op basis van kilometerstand"
            description="Vergelijk getankte liters met gereden kilometers en gemengd verbruik."
            enabled={draft.consumption_enabled}
            onEnabled={(v) => setBool('consumption_enabled', v)}
          >
            <NumberField
              label="Marge (%)"
              value={draft.consumption_margin_pct}
              onChange={(value) => setNumber('consumption_margin_pct', value, DEFAULT_FUEL_CONDITIONS.consumption_margin_pct, 0, 300)}
            />
          </ConditionRow>

          <ConditionRow
            title="Verbruik op basis van woonadres en werklocatie"
            description="Vergelijk liters met woon-werkafstand, werkrooster en gemiddeld voertuigverbruik."
            enabled={draft.route_consumption_enabled}
            onEnabled={(v) => setBool('route_consumption_enabled', v)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Marge (%)"
                value={draft.route_consumption_margin_pct}
                onChange={(value) => setNumber('route_consumption_margin_pct', value, DEFAULT_FUEL_CONDITIONS.route_consumption_margin_pct, 0, 300)}
              />
              <NumberField
                label="Routefactor"
                value={draft.route_distance_multiplier}
                onChange={(value) => setNumber('route_distance_multiplier', value, DEFAULT_FUEL_CONDITIONS.route_distance_multiplier, 1, 2.5)}
              />
            </div>
          </ConditionRow>

          <ConditionRow
            title="Onlogische kilometerstand"
            description="Markeer dalende standen of sprongen boven de ingestelde kilometergrens."
            enabled={draft.mileage_jump_enabled}
            onEnabled={(v) => setBool('mileage_jump_enabled', v)}
          >
            <NumberField
              label="Max. sprong (km)"
              value={draft.mileage_jump_max_km}
              onChange={(value) => setNumber('mileage_jump_max_km', value, DEFAULT_FUEL_CONDITIONS.mileage_jump_max_km, 1, 5000)}
            />
          </ConditionRow>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => onSave(draft)} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" /> {saving ? 'Opslaan...' : 'Voorwaarden opslaan'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

const ConditionRow = ({ title, description, enabled, onEnabled, children }: {
  title: string;
  description: string;
  enabled: boolean;
  onEnabled: (value: boolean) => void;
  children?: ReactNode;
}) => (
  <div className="rounded-md border p-4 space-y-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      <Switch checked={enabled} onCheckedChange={onEnabled} />
    </div>
    {children && <div className={enabled ? '' : 'opacity-50 pointer-events-none'}>{children}</div>}
  </div>
);

const NumberField = ({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) => {
  const id = useId();
  return (
    <div className="space-y-1.5 max-w-40">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
};
