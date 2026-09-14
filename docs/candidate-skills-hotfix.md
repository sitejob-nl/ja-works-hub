# Kandidaat aanmaken met vaardigheden — hotfix 14 september 2026

- Bestaande skills worden nu eerst op organisatie + genormaliseerde naam opgezocht. De oude
  `INSERT ... ON CONFLICT` activeerde ook bij bestaande skills de `settings.manage`-guard,
  waardoor backoffice de kandidaat niet kon opslaan. Rollen, RLS en functie-ACL blijven gelijk.
- Migratie `20260914093807_reuse_existing_skills_without_catalog_write` is op productie toegepast.
  Supabase security/performance advisors gecontroleerd; geen melding over de gewijzigde helper.
- `Recruitmentpartner` toegevoegd aan de gedeelde bronopties voor aanmaken én profielbewerking.
- QA: geïsoleerde PostgreSQL-test toont oud rood / nieuw groen (`python3 scripts/candidate-skills-db-test.py`).
  `scripts/candidate-skills-live-qa.sql` slaagt met de daadwerkelijke backoffice-rechten van de melder:
  kandidaat + profiellink aanmaken, skills wijzigen, catalogus onveranderd en verboden writes geweigerd.
  Alle live SQL-testdata wordt teruggedraaid. Browser-QA via `playwright.candidate-skills.config.ts`
  slaagt in de demo-organisatie en ruimt eigen kandidaten op. Geen berichten verstuurd.
- Quality-gate lokaal groen: lint (0 errors), typecheck, build en 1.955 unit-tests.

