-- Huisvestingsklacht uit het medewerkersportaal routeren naar een verantwoordelijke.
--
-- Tot nu toe schreef "Onderhoud melden" in het portaal alleen een rij in housing_inspections
-- (inspection_type = 'klacht'). Die was uitsluitend zichtbaar voor wie toevallig de Inspecties-tab
-- van dát pand opende — geen taak, geen notificatie. In de praktijk kwam de melding dus nooit aan.
--
-- Waarom een trigger en niet client-side: de melder is een portaalgebruiker (rol `medewerker`) en
-- recruiter_tasks.tenant_insert eist is_internal_user(). Een portaalgebruiker kán dus geen taak
-- aanmaken. Een SECURITY DEFINER-trigger lost dat op én dekt meteen elk ander pad waarlangs een
-- klacht binnenkomt (intern aangemaakt, import, toekomstige edge function).

-- Verantwoordelijke voor huisvesting: expliciete org-instelling, anders een actieve admin.
-- Spiegelt settings.contract_owner_profile_id uit de plaatsingsflow.
create or replace function public.resolve_housing_owner(p_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- 1. Ingestelde huisvestingsverantwoordelijke, mits nog een actief intern profiel in deze org.
    --    De validatie voorkomt een taak die aan een vertrokken of verkeerd-org profiel hangt.
    -- De uuid-cast staat achter een vormcheck: rommel in settings zou anders een exception
    -- gooien, die de trigger opvangt — met als stil gevolg dat er hélemaal geen taak komt.
    (select p.id
       from profiles p, organizations o
      where o.id = p_org_id
        and o.settings->>'housing_owner_profile_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and p.id = (o.settings->>'housing_owner_profile_id')::uuid
        and p.organization_id = p_org_id
        and p.role in ('admin', 'intercedent', 'backoffice', 'finance')
        and p.is_active),
    -- 2. Fallback: oudste actieve admin. Liever bij de verkeerde persoon dan nergens.
    (select p.id
       from profiles p
      where p.organization_id = p_org_id
        and p.role = 'admin'
        and p.is_active
      order by p.created_at
      limit 1)
  );
$$;

comment on function public.resolve_housing_owner(uuid) is
  'Profiel-id dat huisvestingsmeldingen krijgt: settings.housing_owner_profile_id, anders de oudste actieve admin.';

-- Alleen de trigger roept 'm aan (die draait als definer). Zonder revoke is de functie via
-- /rest/v1/rpc bereikbaar voor anon en lekt hij per org een profiel-id. Zelfde lijn als
-- find_duplicate_candidates / merge_candidate_records.
revoke all on function public.resolve_housing_owner(uuid) from public;
revoke all on function public.resolve_housing_owner(uuid) from anon;
revoke all on function public.resolve_housing_owner(uuid) from authenticated;

create or replace function public.tg_housing_complaint_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_property text;
  v_unit text;
  v_resident text;
  v_where text;
  v_title text;
begin
  -- Alleen klachten routeren. Check-in/-out en periodieke inspecties zijn gepland werk.
  if new.inspection_type is distinct from 'klacht' then
    return new;
  end if;

  v_owner := public.resolve_housing_owner(new.organization_id);

  select coalesce(nullif(p.name, ''), nullif(trim(concat_ws(' ', p.address_street, p.address_city)), ''))
    into v_property
    from properties p
   where p.id = new.property_id;

  select u.name into v_unit from units u where u.id = new.unit_id;

  -- Naam van de melder, zodat Rob niet eerst hoeft uit te zoeken wie er belde.
  select trim(concat_ws(' ', c.first_name, c.last_name))
    into v_resident
    from housing_assignments ha
    join candidates c on c.id = ha.candidate_id
   where ha.id = new.housing_assignment_id;

  v_where := coalesce(v_property, 'Onbekend pand') || coalesce(' — ' || v_unit, '');
  v_title := 'Melding huisvesting: ' || v_where;

  insert into recruiter_tasks (
    organization_id, assigned_to, title, description,
    priority, status, category, related_entity_type, related_entity_id, due_date
  ) values (
    new.organization_id,
    v_owner,
    v_title,
    concat_ws(
      E'\n',
      coalesce(new.description, 'Geen omschrijving meegegeven.'),
      case when v_resident is not null then 'Gemeld door: ' || v_resident end,
      case when coalesce(array_length(new.photos, 1), 0) > 0
           then array_length(new.photos, 1) || ' foto''s bijgevoegd' end
    ),
    'high',
    'open',
    'huisvesting',
    'huis',
    new.property_id,
    current_date
  );

  -- Tweede signaal in de belletjes-notificaties. Die zijn org-breed (employee_notifications kent
  -- geen doel-profiel), dus de taak blijft de daadwerkelijke toewijzing.
  insert into employee_notifications (
    organization_id, type, title, message, severity, reference_table, reference_id, candidate_id
  ) values (
    new.organization_id,
    'overig',
    v_title,
    left(coalesce(new.description, 'Nieuwe melding vanuit het medewerkersportaal.'), 500),
    'warning',
    'housing_inspections',
    new.id,
    (select ha.candidate_id from housing_assignments ha where ha.id = new.housing_assignment_id)
  );

  return new;
exception
  when others then
    -- Een melding mag nóóit verloren gaan doordat de routering struikelt: de inspectie zelf is
    -- het bewijsstuk. Loggen en doorgaan.
    raise warning 'tg_housing_complaint_notify faalde voor inspectie %: %', new.id, sqlerrm;
    return new;
end;
$$;

-- Triggerfuncties horen niet in de REST-API. Aanroepen zou sowieso falen, maar de advisor
-- (anon_security_definer_function_executable) vlagt ze terecht — dus dichtzetten.
revoke all on function public.tg_housing_complaint_notify() from public;
revoke all on function public.tg_housing_complaint_notify() from anon;
revoke all on function public.tg_housing_complaint_notify() from authenticated;

drop trigger if exists housing_complaint_notify on public.housing_inspections;
create trigger housing_complaint_notify
  after insert on public.housing_inspections
  for each row
  execute function public.tg_housing_complaint_notify();
