-- Fase B (welkomstvideo): medewerkers mogen organizations niet lezen (org_select vereist
-- is_internal_user()), en settings bevat gevoelige zaken als role_permissions. Deze RPC geeft
-- alleen de publieke portaal-velden van de eigen organisatie terug.
create or replace function public.get_portal_org_info()
returns table (name text, logo_url text, welcome_video_url text)
language sql
stable
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $$
  select
    o.name,
    o.logo_url,
    nullif(o.settings->>'portal_welcome_video_url', '')
  from public.organizations o
  where o.id = public.get_user_org_id()
$$;

revoke all on function public.get_portal_org_info() from public;
revoke all on function public.get_portal_org_info() from anon;
grant execute on function public.get_portal_org_info() to authenticated;
