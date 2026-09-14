// Isolated PostgreSQL contract test. Never connects to Supabase or production.
// Run: node scripts/test-feedback-db.mjs (requires Docker, postgres:17-alpine).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const container = `ja-feedback-db-test-${process.pid}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const bootstrap = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public,auth to authenticated,anon,service_role;
create table organizations (id uuid primary key);
create table profiles (id uuid primary key, organization_id uuid not null references organizations, role text, is_active boolean default true);
create function get_user_org_id() returns uuid language sql stable security definer set search_path=public as $$ select organization_id from profiles where id=auth.uid() and is_active $$;
create function is_internal_user() returns boolean language sql stable security definer set search_path=public as $$ select coalesce((select role in ('admin','intercedent','backoffice','finance') from profiles where id=auth.uid() and is_active),false) $$;
create function is_superadmin() returns boolean language sql stable as $$ select auth.uid()='99999999-9999-4999-8999-999999999999'::uuid $$;
create table communications (id uuid primary key, organization_id uuid not null references organizations, candidate_id uuid, company_id uuid, channel text, direction text,
constraint chk_comm_target check(candidate_id is not null or company_id is not null));
create table storage.buckets (id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
insert into organizations values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into profiles values
('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin',true),
('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','admin',true),
('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','medewerker',true),
('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','finance',true);
`;
const migration = readFileSync(new URL('../supabase/migrations/20260914120000_feedback_reports.sql', import.meta.url), 'utf8');
const checks = `
create function pg_temp.assert(ok boolean, label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
set role service_role;
select * from create_feedback_report('{
"id":"aaaaaaaa-0000-4000-8000-000000000001","organization_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
"submitted_by":"11111111-1111-4111-8111-111111111111","reporter_name":"Test","reporter_email":"test@example.invalid",
"kind":"bug","title":"Test bug","description":"Test description","steps":"","expected":"","diagnostics":{},"request_hash":"hash","has_screenshot":false}');
-- Same request twice must return the same row/number without consuming rate limit.
select * from create_feedback_report('{
"id":"aaaaaaaa-0000-4000-8000-000000000001","organization_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
"submitted_by":"11111111-1111-4111-8111-111111111111","request_hash":"hash"}');
reset role;
select pg_temp.assert((select count(*)=1 from feedback_reports),'idempotent insert');
do $$ begin
  perform create_feedback_report('{"id":"aaaaaaaa-0000-4000-8000-000000000001","organization_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","submitted_by":"22222222-2222-4222-8222-222222222222","request_hash":"hash"}');
  raise exception 'FAIL cross-tenant ID reuse';
exception when invalid_parameter_value then null; end $$;
do $$ begin
  perform create_feedback_report('{"id":"aaaaaaaa-0000-4000-8000-000000000001","organization_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","submitted_by":"11111111-1111-4111-8111-111111111111","request_hash":"changed"}');
  raise exception 'FAIL mutated retry';
exception when invalid_parameter_value then null; end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select pg_temp.assert((select count(*)=1 from feedback_reports),'owner can read');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select pg_temp.assert((select count(*)=0 from feedback_reports),'cross-tenant denied');
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select pg_temp.assert((select count(*)=0 from feedback_reports),'portal denied');
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select pg_temp.assert((select count(*)=0 from feedback_reports),'colleague cannot read private feedback');
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',false);
select pg_temp.assert((select count(*)=1 from feedback_reports),'superadmin can read');
do $$ begin perform create_feedback_report('{}'); raise exception 'FAIL browser RPC'; exception when insufficient_privilege then null; end $$;
do $$ begin update feedback_reports set email_status='sent'; raise exception 'FAIL client status write'; exception when insufficient_privilege then null; end $$;
reset role;
select pg_temp.assert(not has_table_privilege('anon','feedback_reports','select'),'anonymous select revoked');
select pg_temp.assert(not has_table_privilege('authenticated','feedback_reports','insert'),'browser insert revoked');
select pg_temp.assert(not has_function_privilege('anon','create_feedback_report(jsonb)','execute'),'anonymous RPC revoked');
update profiles set is_active=false where id='11111111-1111-4111-8111-111111111111';
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select pg_temp.assert((select count(*)=0 from feedback_reports),'disabled owner denied');
reset role;
insert into communications values('aaaaaaaa-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',null,'email','outbound',null);
do $$ begin
  insert into communications values('bbbbbbbb-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null,null,'email','outbound','aaaaaaaa-0000-4000-8000-000000000001');
  raise exception 'FAIL cross-tenant communication link';
exception when foreign_key_violation then null; end $$;
insert into communications values('aaaaaaaa-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'email','outbound','aaaaaaaa-0000-4000-8000-000000000001');
do $$ begin
  insert into communications values('cccccccc-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'email','outbound',null);
  raise exception 'FAIL target-free communication';
exception when check_violation then null; end $$;
select pg_temp.assert((select public=false from storage.buckets where id='feedback-screenshots'),'private screenshot bucket');
-- Ten per hour; a retry of an existing ID is still allowed at the limit.
do $$ declare n int; body jsonb; begin
  for n in 2..10 loop
    body=jsonb_build_object('id',gen_random_uuid(),'organization_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','submitted_by','11111111-1111-4111-8111-111111111111','reporter_name','Test','reporter_email','test@example.invalid','kind','idea','title','Test idea','description','Description','steps','','expected','','diagnostics','{}'::jsonb,'request_hash',n::text,'has_screenshot',false);
    perform create_feedback_report(body);
  end loop;
  begin
    perform create_feedback_report(body || jsonb_build_object('id',gen_random_uuid()));
    raise exception 'FAIL missing rate limit';
  exception when raise_exception then
    if sqlerrm <> 'feedback_rate_limited' then raise; end if;
  end;
end $$;
select pg_temp.assert((select count(*)=10 from feedback_reports),'per-user throttle');
`;
try {
  docker('run', '--rm', '-d', '--name', container, '--network', 'none', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine');
  for (let i = 0; i < 30; i++) {
    try { docker('exec', container, 'pg_isready', '-U', 'postgres'); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 300)); }
  }
  execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], {
    input: bootstrap + migration + migration + checks, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  console.log('PASS: migration applies twice; ownership, tenant/portal isolation, RPC grants, concept logging, idempotency and rate limit verified.');
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  try { docker('rm', '-f', container); } catch { /* already removed */ }
}
