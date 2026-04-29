-- Carerix: scope-default uitbreiden met de wrapper-scope `urn:cx/cx5Wrapper:data:manage`.
--
-- Achtergrond: het CR*-schema (crEmployeePage, crMatchPage, crJobPage, crEmploymentPage,
-- crAttachmentPage, crTodoPage) zit op dezelfde GraphQL-endpoint als het v1-schema,
-- maar is alleen toegankelijk met een ruimere scope. Zonder dat blijven we hangen op
-- de minimale v1-velden (basisnaam + email) en kunnen we geen documenten, plaatsingen,
-- matches of notities migreren.
--
-- Bestaande connecties worden NIET aangeraakt — die blijven werken met hun huidige
-- (smallere) scope-set. Alleen nieuwe organisaties krijgen direct de bredere default.

ALTER TABLE public.carerix_config
  ALTER COLUMN scope SET DEFAULT
    'urn:cx/cx5Wrapper:data:manage '
    || 'urn:cx/core:data/companies:read '
    || 'urn:cx/core:data/contacts:read '
    || 'urn:cx/core:data/candidates:read '
    || 'urn:cx/core:data/placements:read '
    || 'urn:cx/core:data/vacancies:read '
    || 'urn:cx/core:data/matches:read '
    || 'urn:cx/activities:data/notes:read '
    || 'urn:cx/activities:data/tasks:read';
