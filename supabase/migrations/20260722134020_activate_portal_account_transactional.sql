-- portal-activate deed vier database-schrijfacties los van elkaar: profiel aanmaken, kandidaat
-- bijwerken, de employees-spiegel bijwerken en de uitnodiging afstempelen. Faalde er één
-- halverwege, dan bleven de eerdere staan: de gebruiker kón inloggen maar zag een leeg
-- portaal, de uitnodiging bleef ongebruikt, en een tweede poging strandde op "e-mailadres
-- bestaat al" (409). Opruimen moest met de hand.
--
-- Alles zit nu in één transactie. De auth-gebruiker valt daar buiten (dat is een GoTrue-
-- API-aanroep, geen SQL); de edge functie ruimt die op als deze RPC faalt.
--
-- De uitnodiging wordt meteen bovenaan geclaimd met een voorwaardelijke UPDATE. Dat sluit
-- tegelijk het gaatje tussen "token gecontroleerd" en "token gebruikt": twee gelijktijdige
-- activaties kunnen niet allebei slagen, want de tweede krijgt nul rijen terug.
create or replace function public.activate_portal_account(
  p_token text,
  p_user_id uuid,
  p_language text
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $$
declare
  v_invite public.portal_invites;
  v_candidate public.candidates;
  v_full_name text;
begin
  update public.portal_invites
     set used_at = now()
   where token = p_token
     and used_at is null
     and expires_at > now()
  returning * into v_invite;

  if v_invite.id is null then
    raise exception 'Ongeldige of verlopen uitnodiging' using errcode = '22023';
  end if;

  select * into v_candidate from public.candidates where id = v_invite.candidate_id;

  if v_candidate.id is null then
    raise exception 'Kandidaat niet gevonden' using errcode = '22023';
  end if;

  v_full_name := nullif(trim(
    coalesce(v_candidate.first_name, '') || ' ' || coalesce(v_candidate.last_name, '')
  ), '');

  insert into public.profiles (id, organization_id, email, full_name, role)
  values (p_user_id, v_candidate.organization_id, v_invite.email, v_full_name, 'medewerker');

  update public.candidates
     set auth_user_id = p_user_id,
         portal_enabled = true,
         portal_activated_at = now(),
         portal_language = p_language
   where id = v_candidate.id;

  -- De employees-spiegel is sinds 20260722132232 niet meer waar de portaal-RLS aan hangt;
  -- de recruiter-UI leest hem nog wel. Ontbreekt de rij, dan raakt deze update nul rijen —
  -- dat is geen reden om de activatie te laten mislukken.
  update public.employees
     set auth_user_id = p_user_id,
         portal_enabled = true,
         portal_activated_at = now(),
         portal_language = p_language
   where (v_invite.employee_id is not null and id = v_invite.employee_id)
      or (v_invite.employee_id is null and candidate_id = v_candidate.id);

  return v_candidate.id;
end;
$$;

-- Alleen de edge functie (service_role) mag dit aanroepen; hij maakt een profiel aan en
-- koppelt een auth-gebruiker, dus hij hoort niet vanaf de client bereikbaar te zijn.
revoke all on function public.activate_portal_account(text, uuid, text) from public;
revoke all on function public.activate_portal_account(text, uuid, text) from anon;
revoke all on function public.activate_portal_account(text, uuid, text) from authenticated;

comment on function public.activate_portal_account(text, uuid, text) is
  'Maakt in één transactie het profiel, koppelt de auth-gebruiker aan kandidaat + employees-spiegel en stempelt de uitnodiging af. Alleen aan te roepen door portal-activate met de service-role-sleutel.';
