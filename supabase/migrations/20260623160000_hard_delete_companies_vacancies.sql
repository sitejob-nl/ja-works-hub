-- Harde verwijderbaarheid voor opdrachtgevers + vacatures (go-live data-hygiëne + AVG).
--
-- Tot nu toe konden beide alleen gedeactiveerd (is_active=false) of gesloten (status) worden;
-- er was geen DELETE-policy, dus RLS blokkeerde elke delete (deny-by-default). Hierdoor bleef
-- testdata / foutief aangemaakte data zichtbaar in de database. We voegen een role-gated
-- DELETE-policy toe: alleen `admin` binnen de eigen organisatie mag definitief verwijderen.
--
-- Bestaande foreign keys blijven beschermen tegen het per ongeluk wissen van gekoppelde data:
--   * companies <- invoices is ON DELETE RESTRICT → een opdrachtgever met facturen kan niet
--     verwijderd worden (Postgres geeft 23503; de UI vangt dat af met een duidelijke melding).
--   * vacancies <- matches is ON DELETE CASCADE → matches van een vacature gaan mee (gewenst
--     voor het opschonen van testdata); een vacature met een plaatsing blokkeert via RESTRICT.
--
-- Idempotent: DROP ... IF EXISTS + CREATE. Spiegelt het bestaande role-gate-patroon
-- (get_user_org_id() + get_user_role() = 'admin'::user_role) uit eerdere migraties.

DROP POLICY IF EXISTS tenant_delete ON public.companies;
CREATE POLICY tenant_delete ON public.companies FOR DELETE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.get_user_role() = 'admin'::user_role);

DROP POLICY IF EXISTS tenant_delete ON public.vacancies;
CREATE POLICY tenant_delete ON public.vacancies FOR DELETE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.get_user_role() = 'admin'::user_role);
