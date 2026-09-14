#!/usr/bin/env python3
"""Isolated PostgreSQL regression for catalog reuse; no network or production data.

Uses the real catalog helper, candidate sync and write guard from migrations.
Minimal auth helpers model backoffice/admin; live QA separately checks the actual
affected user's full permission matrix and RLS in a rolled-back transaction.
"""
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'ja-candidate-skills-qa-' + uuid.uuid4().hex[:8]
ORG = '00000000-0000-0000-0000-000000000001'
OTHER = '00000000-0000-0000-0000-000000000002'


def sql(value, check=True):
    result = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres',
                             '-v', 'ON_ERROR_STOP=1', '-At'], input=value, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result


def function(path, name):
    source = (ROOT / 'supabase/migrations' / path).read_text()
    return re.search(r'CREATE OR REPLACE FUNCTION public\.' + name + r'\(.*?\n\$\$;', source, re.S).group()


def actor(body, role='authenticated', app_role='backoffice', org=ORG):
    return f"""BEGIN; SET LOCAL ROLE {role};
      SET LOCAL qa.app_role = '{app_role}'; SET LOCAL qa.org = '{org}';
      SET LOCAL request.jwt.claim.role = '{role}'; {body} ROLLBACK;"""


def denies(statement):
    return f"DO $$ BEGIN BEGIN {statement}; RAISE EXCEPTION 'Expected permission denial'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;"


try:
    subprocess.run(['docker', 'run', '-d', '--rm', '--pull=never', '--network=none',
                    '--name', CONTAINER, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
                    'postgres:17-alpine'], check=True, capture_output=True)
    for _ in range(100):
        if sql('select 1;', check=False).returncode == 0:
            break
        time.sleep(.2)
    else:
        raise RuntimeError('PostgreSQL did not become ready')
    sql("""
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
      CREATE FUNCTION public.is_superadmin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION public.is_internal_user() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('qa.app_role',true) IN ('backoffice','admin') $$;
      CREATE FUNCTION public.has_role_permission(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('qa.app_role',true)='admin' OR (current_setting('qa.app_role',true)='backoffice' AND p='candidates.edit') $$;
      CREATE FUNCTION public.normalize_skill_name(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(trim(regexp_replace(lower(coalesce(value,'')), '[^a-z0-9]+', ' ', 'g')),'') $$;
      CREATE TABLE public.skills(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,name text NOT NULL,normalized_name text NOT NULL,is_active boolean NOT NULL DEFAULT true,updated_at timestamptz DEFAULT now(),UNIQUE(organization_id,normalized_name));
      CREATE TABLE public.skill_aliases(organization_id uuid,skill_id uuid REFERENCES skills(id),alias text,normalized_alias text,source text,UNIQUE(organization_id,normalized_alias));
      CREATE TABLE public.candidates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,skills text[]);
      CREATE TABLE public.candidate_skills(organization_id uuid,candidate_id uuid REFERENCES candidates(id),skill_id uuid REFERENCES skills(id),source text,PRIMARY KEY(candidate_id,skill_id));
      GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
      DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['skills','skill_aliases','candidates','candidate_skills'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
        EXECUTE format('CREATE POLICY tenant ON public.%I TO authenticated USING (organization_id=current_setting(''qa.org'')::uuid AND public.is_internal_user()) WITH CHECK (organization_id=current_setting(''qa.org'')::uuid AND public.is_internal_user())',t);
      END LOOP; END $$;
    """)
    sql(function('20260713120000_enforce_role_permissions_end_to_end.sql', 'enforce_role_permission_write'))
    sql(function('20260525110000_phase1_matching_v2.sql', 'sync_candidate_skills_from_array'))
    sql((ROOT / 'supabase/migrations/20260603060000_skills_autodiscovery_inactive.sql').read_text())
    sql(f"""
      INSERT INTO skills(organization_id,name,normalized_name) VALUES('{ORG}','Lasrobot bedienen','lasrobot bedienen');
      CREATE TRIGGER role_permission_write_guard BEFORE INSERT OR UPDATE OR DELETE ON skills FOR EACH ROW EXECUTE FUNCTION enforce_role_permission_write('settings.manage');
      CREATE TRIGGER role_permission_write_guard BEFORE INSERT OR UPDATE OR DELETE ON skill_aliases FOR EACH ROW EXECUTE FUNCTION enforce_role_permission_write('settings.manage');
      CREATE TRIGGER role_permission_write_guard BEFORE INSERT OR UPDATE OR DELETE ON candidates FOR EACH ROW EXECUTE FUNCTION enforce_role_permission_write('candidates.edit');
      CREATE TRIGGER role_permission_write_guard BEFORE INSERT OR UPDATE OR DELETE ON candidate_skills FOR EACH ROW EXECUTE FUNCTION enforce_role_permission_write('candidates.edit');
      CREATE TRIGGER sync AFTER INSERT OR UPDATE OF skills ON candidates FOR EACH ROW EXECUTE FUNCTION sync_candidate_skills_from_array();
    """)
    create = f"INSERT INTO candidates(organization_id,skills) VALUES('{ORG}',ARRAY['Lasrobot bedienen'])"
    before = sql(actor(create + ';'), check=False)
    assert before.returncode and 'Onvoldoende rechten voor INSERT op skills' in before.stderr
    print('PASS: reproduced original backoffice INSERT failure')
    migration = next((ROOT / 'supabase/migrations').glob('*_reuse_existing_skills_without_catalog_write.sql')).read_text()
    sql(migration)
    sql(migration)
    sql(actor(f"""
      DO $$ DECLARE c uuid; s uuid; baseline jsonb; BEGIN
        SELECT id,to_jsonb(skills) INTO s,baseline FROM skills WHERE organization_id='{ORG}';
        INSERT INTO candidates(organization_id,skills) VALUES('{ORG}',ARRAY['Lasrobot bedienen',' LASROBOT   BEDIENEN ',' ']) RETURNING id INTO c;
        ASSERT (SELECT count(*) FROM candidate_skills WHERE candidate_id=c AND skill_id=s)=1;
        UPDATE candidates SET skills=ARRAY[]::text[] WHERE id=c;
        ASSERT (SELECT count(*) FROM candidate_skills WHERE candidate_id=c)=0;
        UPDATE candidates SET skills=ARRAY['Lasrobot bedienen'] WHERE id=c;
        ASSERT (SELECT count(*) FROM candidate_skills WHERE candidate_id=c AND skill_id=s)=1;
        ASSERT (SELECT to_jsonb(skills) FROM skills WHERE id=s)=baseline;
        ASSERT (SELECT count(*) FROM skill_aliases)=0;
      END $$;
    """))
    print('PASS: create, normalized duplicates, clear and edit; catalog and aliases unchanged')
    for statement in [
        f"INSERT INTO skills(organization_id,name,normalized_name) VALUES('{ORG}','Forbidden','forbidden')",
        "UPDATE skills SET name='Forbidden'",
        "DELETE FROM skills",
        f"INSERT INTO candidates(organization_id,skills) VALUES('{OTHER}',ARRAY['Lasrobot bedienen'])",
        "SELECT public.upsert_skill_for_org('" + ORG + "','Lasrobot bedienen')",
    ]:
        sql(actor(denies(statement)))
    print('PASS: catalog INSERT/UPDATE/DELETE, cross-tenant create and direct helper denied')
    sql(actor(f"""DO $$ DECLARE s uuid; BEGIN
      s:=upsert_skill_for_org('{OTHER}','Lasrobot bedienen');
      ASSERT (SELECT organization_id='{OTHER}' AND NOT is_active FROM skills WHERE id=s);
      ASSERT upsert_skill_for_org('{OTHER}','LASROBOT BEDIENEN')=s;
      ASSERT (SELECT count(*) FROM skill_aliases WHERE skill_id=s)=1;
      ASSERT NOT has_function_privilege('anon','public.upsert_skill_for_org(uuid,text)','EXECUTE');
    END $$;""", role='service_role', app_role='admin'))
    print('PASS: authorized discovery remains inactive, tenant-scoped and idempotent; anon denied')
finally:
    subprocess.run(['docker', 'rm', '-f', '-v', CONTAINER], capture_output=True)
