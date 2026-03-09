import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganizationId } from "@/hooks/useOrganizationId";

interface SegmentBuilderProps {
  filter: any;
  onChange: (filter: any, count: number) => void;
}

export function SegmentBuilder({ filter, onChange }: SegmentBuilderProps) {
  const organizationId = useOrganizationId();
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(filter.status || []);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(filter.skills || []);
  const [selectedCompliance, setSelectedCompliance] = useState<string[]>(filter.compliance_status || []);
  const [city, setCity] = useState(filter.city || "");
  const [skillInput, setSkillInput] = useState("");
  const [count, setCount] = useState(0);

  const statuses = ["nieuw", "actief", "beschikbaar", "geplaatst", "inactief"];
  const complianceStatuses = ["compleet", "incompleet", "verlopen"];

  useEffect(() => {
    updateFilter();
  }, [selectedStatuses, selectedSkills, selectedCompliance, city]);

  const updateFilter = async () => {
    const newFilter: any = {};
    if (selectedStatuses.length > 0) newFilter.status = selectedStatuses;
    if (selectedSkills.length > 0) newFilter.skills = selectedSkills;
    if (selectedCompliance.length > 0) newFilter.compliance_status = selectedCompliance;
    if (city) newFilter.city = city;

    // Get count
    if (organizationId) {
      const { count: candidateCount } = await supabase.rpc("get_campaign_candidates", {
        p_org_id: organizationId,
        p_filter: newFilter,
        p_channel: "whatsapp",
      }).then((res) => ({ count: res.data?.length || 0 }));

      setCount(candidateCount);
      onChange(newFilter, candidateCount);
    }
  };

  const addSkill = () => {
    if (skillInput && !selectedSkills.includes(skillInput)) {
      setSelectedSkills([...selectedSkills, skillInput]);
      setSkillInput("");
    }
  };

  const removeSkill = (skill: string) => {
    setSelectedSkills(selectedSkills.filter((s) => s !== skill));
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Status</Label>
        <Select
          value={selectedStatuses[0] || ""}
          onValueChange={(value) => {
            if (value && !selectedStatuses.includes(value)) {
              setSelectedStatuses([...selectedStatuses, value]);
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecteer status" />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-2 mt-2">
          {selectedStatuses.map((status) => (
            <Badge key={status} variant="secondary">
              {status}
              <X
                className="w-3 h-3 ml-1 cursor-pointer"
                onClick={() => setSelectedStatuses(selectedStatuses.filter((s) => s !== status))}
              />
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <Label>Skills</Label>
        <div className="flex gap-2">
          <Input
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && addSkill()}
            placeholder="Voeg skill toe"
          />
          <button
            onClick={addSkill}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            +
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {selectedSkills.map((skill) => (
            <Badge key={skill} variant="secondary">
              {skill}
              <X className="w-3 h-3 ml-1 cursor-pointer" onClick={() => removeSkill(skill)} />
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <Label>Compliance Status</Label>
        <Select
          value={selectedCompliance[0] || ""}
          onValueChange={(value) => {
            if (value && !selectedCompliance.includes(value)) {
              setSelectedCompliance([...selectedCompliance, value]);
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecteer compliance status" />
          </SelectTrigger>
          <SelectContent>
            {complianceStatuses.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-2 mt-2">
          {selectedCompliance.map((status) => (
            <Badge key={status} variant="secondary">
              {status}
              <X
                className="w-3 h-3 ml-1 cursor-pointer"
                onClick={() => setSelectedCompliance(selectedCompliance.filter((s) => s !== status))}
              />
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor="city">Stad</Label>
        <Input
          id="city"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Bijv: Amsterdam"
        />
      </div>
    </div>
  );
}
