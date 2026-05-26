-- Seed stronger Phase 1 skill aliases for existing tenant skill catalogs.
-- New aliases are organization-scoped and only attach when the canonical skill already exists.

WITH alias_seed(canonical_name, alias) AS (
  VALUES
    ('MIG-MAG lassen', 'MIG'),
    ('MIG-MAG lassen', 'MAG'),
    ('MIG-MAG lassen', 'MIG/MAG'),
    ('MIG-MAG lassen', 'MIGMAG'),
    ('MIG-MAG lassen', 'MIG-MAG lasser'),
    ('MIG-MAG lassen', 'MIG/MAG lasser'),
    ('MIG-MAG lassen', 'CO2 lassen'),
    ('MIG-MAG lassen', 'CO2 lasser'),
    ('TIG lassen', 'TIG lasser'),
    ('TIG lassen', 'TIG welding'),
    ('Heftruck', 'Heftruckchauffeur'),
    ('Heftruck', 'Heftruck chauffeur'),
    ('Heftruck', 'Heftruck rijden'),
    ('Heftruck', 'Heftruck certificaat'),
    ('Heftruck', 'Heftruck certificatie'),
    ('Heftruck', 'Forklift'),
    ('Heftruck', 'Forklift driver'),
    ('Heftruck', 'Forklift operator'),
    ('Reachtruck', 'Reachtruckchauffeur'),
    ('Reachtruck', 'Reachtruck chauffeur'),
    ('Reachtruck', 'Reachtruck rijden'),
    ('Reachtruck', 'Reachtruck certificaat'),
    ('Reachtruck', 'Reach truck'),
    ('EPT', 'Electro pallet truck'),
    ('EPT', 'Elektrische pallettruck'),
    ('EPT', 'Elektrische pallet truck'),
    ('EPT', 'Pompwagen elektrisch'),
    ('Orderpicken', 'Order picking'),
    ('Orderpicken', 'Order picken'),
    ('Orderpicken', 'Orderpicker'),
    ('Orderpicken', 'Orders picken'),
    ('Productiewerk', 'Productiemedewerker'),
    ('Productiewerk', 'Productie medewerker'),
    ('Productiewerk', 'Productie werk'),
    ('Productiewerk', 'Productiekracht'),
    ('Productiewerk', 'Production worker'),
    ('Inpakken', 'Inpakker'),
    ('Inpakken', 'Inpakwerk'),
    ('Inpakken', 'Verpakken'),
    ('Inpakken', 'Packer'),
    ('Inpakken', 'Packing'),
    ('Kwaliteitscontrole', 'QC'),
    ('Kwaliteitscontrole', 'Quality Control'),
    ('Kwaliteitscontrole', 'Kwaliteits controle'),
    ('Kwaliteitscontrole', 'Controle kwaliteit'),
    ('Scanner werken', 'Scanner'),
    ('Scanner werken', 'Scannen'),
    ('Scanner werken', 'Scannerwerk'),
    ('Scanner werken', 'Handscanner'),
    ('Scanner werken', 'RF scanner'),
    ('Technische tekening lezen', 'Tekening lezen'),
    ('Technische tekening lezen', 'Technische tekeningen lezen'),
    ('Technische tekening lezen', 'Technical drawing'),
    ('Technische tekening lezen', 'Blueprint reading'),
    ('VCA', 'VCA Basis'),
    ('VCA', 'VCA VOL'),
    ('VCA', 'VCA certificaat'),
    ('VCA', 'VCA diploma'),
    ('VCA', 'Basisveiligheid VCA'),
    ('VCA', 'Veiligheid checklist aannemers'),
    ('HACCP', 'HACCP certificaat'),
    ('HACCP', 'HACCP diploma'),
    ('HACCP', 'Food safety'),
    ('HACCP', 'Voedselveiligheid')
)
INSERT INTO public.skill_aliases (
  organization_id,
  skill_id,
  alias,
  normalized_alias,
  source,
  is_active
)
SELECT
  skills.organization_id,
  skills.id,
  alias_seed.alias,
  public.normalize_skill_name(alias_seed.alias),
  'phase1_seed',
  true
FROM alias_seed
JOIN public.skills
  ON skills.normalized_name = public.normalize_skill_name(alias_seed.canonical_name)
WHERE public.normalize_skill_name(alias_seed.alias) IS NOT NULL
  AND public.normalize_skill_name(alias_seed.alias) <> skills.normalized_name
ON CONFLICT (organization_id, normalized_alias) DO NOTHING;
