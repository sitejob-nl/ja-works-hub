-- Ticket "Documenttypen voor opdrachtgevers uitbreiden" (buglijst 02-09-2026).
--
-- Ontwerpkeuze — enum uitbreiden vs. opzoektabel: documents.type blijft de
-- bestaande Postgres-enum `document_type` ONGEWIJZIGD (geen ALTER TYPE). De
-- kandidaatkant gebruikt diezelfde enum voor cv/rijbewijs/loonstrook/etc. en
-- blijft buiten schot. Voor opdrachtgevers komt er in plaats daarvan een
-- aparte, per-organisatie opzoektabel (`company_document_types`), naar het
-- patroon van `skills`/`match_feedback_reasons` (20260525110000): org-scoped
-- rijen, CRUD via Instellingen, geen release nodig voor een nieuw type. Een
-- kale enum-uitbreiding zou de acceptatie-eis "beheerbaar, niet hardgecodeerd"
-- niet waarmaken — dat blijft dan alsnog code + release per nieuw type, en
-- Postgres-enums kunnen sowieso geen waarden meer verliezen (alleen ADD VALUE).
--
-- documents.type wordt nullable: nieuwe bedrijfsdocumenten dragen hun type via
-- company_document_type_id. Voor de 4 types die al in de enum bestonden
-- (contract/reglement/certificaat/overig) wordt `type` ook nog gevuld, via
-- company_document_types.legacy_document_type — puur zodat bestaande code die
-- nog naar `type` kijkt (bv. de kandidaatkant, ongewijzigd) blijft werken.
-- Bestaande documentrijen worden hier niet aangeraakt (AC: "Bestaande
-- documenten houden hun huidige type").
--
-- Raakt de padtrigger `documents_enforce_storage_path`
-- (20260829132004_fix_document_path_merge_and_company.sql) niet: die kijkt
-- alleen naar file_path/candidate_id/organization_id/company_id, nooit naar
-- `type`.

create table if not exists public.company_document_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  label text not null,
  legacy_document_type public.document_type,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

comment on table public.company_document_types is
  'Beheerbare, per-organisatie lijst documenttypen voor opdrachtgeverdocumenten (documents.company_id). Vervangt de hardgecodeerde 4-waarden-array in CompanyDocumentsTab. Beheer via Instellingen > HR & documenten.';
comment on column public.company_document_types.legacy_document_type is
  'Gevuld voor de types die al in de document_type-enum bestonden (contract/reglement/certificaat/overig), zodat documents.type gevuld blijft voor bestaande consumers. Null voor nieuwe types zonder enum-equivalent.';

create index if not exists idx_company_document_types_org
  on public.company_document_types (organization_id, sort_order);

alter table public.company_document_types enable row level security;

drop policy if exists company_document_types_select_internal_org on public.company_document_types;
create policy company_document_types_select_internal_org on public.company_document_types
  for select to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user());

drop policy if exists company_document_types_insert_internal_org on public.company_document_types;
create policy company_document_types_insert_internal_org on public.company_document_types
  for insert to authenticated
  with check (organization_id = public.get_user_org_id() and public.is_internal_user());

drop policy if exists company_document_types_update_internal_org on public.company_document_types;
create policy company_document_types_update_internal_org on public.company_document_types
  for update to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user())
  with check (organization_id = public.get_user_org_id() and public.is_internal_user());

drop policy if exists company_document_types_delete_internal_org on public.company_document_types;
create policy company_document_types_delete_internal_org on public.company_document_types
  for delete to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user());

-- updated_at trigger (zelfde helper als de rest van het schema)
drop trigger if exists set_updated_at on public.company_document_types;
create trigger set_updated_at before update on public.company_document_types
  for each row execute function public.handle_updated_at();

-- === documents: kolom + integriteit ==========================================

alter table public.documents
  add column if not exists company_document_type_id uuid
    references public.company_document_types(id) on delete restrict;

comment on column public.documents.company_document_type_id is
  'Org-beheerd documenttype voor bedrijfsdocumenten (company_document_types). Kandidaatdocumenten laten dit leeg en gebruiken alleen de type-enum.';

create index if not exists idx_documents_company_document_type_id
  on public.documents (company_document_type_id) where company_document_type_id is not null;

alter table public.documents
  alter column type drop not null;

alter table public.documents
  drop constraint if exists documents_has_type;
alter table public.documents
  add constraint documents_has_type
  check (type is not null or company_document_type_id is not null);

-- === Seed: 4 bestaande + 4 nieuwe types (Jeroen: inventarisatie-formulier, =====
-- tekeningen, financieel, vacatures), voor elke bestaande én toekomstige org.

create or replace function public.seed_default_company_document_types(p_org_id uuid)
returns void
language sql
set search_path = ''
as $fn$
  insert into public.company_document_types
    (organization_id, key, label, legacy_document_type, sort_order)
  values
    (p_org_id, 'contract', 'Contract / overeenkomst', 'contract', 10),
    (p_org_id, 'reglement', 'Reglement', 'reglement', 20),
    (p_org_id, 'certificaat', 'Certificaat', 'certificaat', 30),
    (p_org_id, 'inventarisatie_formulier', 'Inventarisatie-formulier', null, 40),
    (p_org_id, 'tekeningen', 'Tekeningen', null, 50),
    (p_org_id, 'financieel', 'Financieel', null, 60),
    (p_org_id, 'vacatures', 'Vacatures', null, 70),
    (p_org_id, 'overig', 'Overig', 'overig', 999)
  on conflict (organization_id, key) do nothing;
$fn$;

revoke all on function public.seed_default_company_document_types(uuid) from public, anon, authenticated;

-- Backfill: elke bestaande organisatie krijgt de 8 defaults.
select public.seed_default_company_document_types(id) from public.organizations;

-- Nieuwe organisaties krijgen dezelfde defaults automatisch, naar het patroon
-- van seed_default_match_feedback_reasons_trg (20260525114500).
create or replace function public.seed_default_company_document_types_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.seed_default_company_document_types(new.id);
  return new;
end;
$fn$;

revoke all on function public.seed_default_company_document_types_trg() from public, anon, authenticated;

drop trigger if exists seed_default_company_document_types_trg on public.organizations;
create trigger seed_default_company_document_types_trg
  after insert on public.organizations
  for each row execute function public.seed_default_company_document_types_trg();
