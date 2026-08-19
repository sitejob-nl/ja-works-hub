-- Buglijst 19-08, punt 10 — "We willen graag documenten kunnen toevoegen aan een
-- klantprofiel. Net zoals bij documenten bij medewerkers."
--
-- documents.candidate_id was NOT NULL, dus een document zonder kandidaat kon er
-- niet in. Zelfde aanpak als bij notes: één tabel, twee mogelijke eigenaren, met
-- een CHECK die precies één van beide afdwingt.
alter table public.documents
  add column if not exists company_id uuid references public.companies(id) on delete restrict;

alter table public.documents
  alter column candidate_id drop not null;

alter table public.documents
  drop constraint if exists documents_owner_exactly_one;
alter table public.documents
  add constraint documents_owner_exactly_one
  check (num_nonnulls(candidate_id, company_id) = 1);

create index if not exists idx_documents_company_id
  on public.documents (company_id) where company_id is not null;

comment on column public.documents.company_id is
  'Opdrachtgever-document. Precies één van candidate_id / company_id is gevuld.';

-- RLS: kandidaatdocumenten blijven achter candidates.view; bedrijfsdocumenten
-- volgen de zichtbaarheid van de opdrachtgever zelf (companies.tenant_select).
-- Zonder deze aanpassing zou een bedrijfsdocument onzichtbaar zijn voor iedereen
-- zonder candidates.view, en zichtbaar voor iedereen mét dat recht — allebei fout.
drop policy if exists tenant_select on public.documents;
create policy tenant_select on public.documents
  for select to authenticated
  using (
    organization_id = get_user_org_id()
    and (
      (candidate_id is not null and has_role_permission('candidates.view'))
      or (company_id is not null and is_internal_user())
    )
  );
