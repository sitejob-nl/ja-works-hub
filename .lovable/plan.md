

# Wat is af en wat moet nog — Overzicht

## Afgerond
- **PWA** — Installeerbaar, service worker, `/installeren` pagina
- **Sprint 3 (deels)** — Reglementen versiebeheer + aftekening, contracttemplates + generatie
- **Sidebar fix** — Vast bij scrollen

## Nog te doen uit het goedgekeurde plan

### Sprint 1: Signalering (klein)
1. **Dashboard widget "Achterstallige huur"** — query `housing_assignments` waar `rent_paid_until < today`, toon als alert card
2. **Dashboard widget "Borg niet betaald"** — `deposit_paid = false` alerts
3. **Automatisch ziektebericht naar opdrachtgever** — bij aanmaken sick_report: lookup actieve plaatsing → contactpersoon → WhatsApp bericht via edge function

### Sprint 2: TODO App (medium)
4. **Tabel `tasks`** — org_id, assigned_to, title, due_date, priority, status, related_entity
5. **Pagina `/taken`** — kanban of lijstweergave + sidebar item
6. **Quick-add** vanuit detail schermen (kandidaat, medewerker, vacature)

### Sprint 3 resterend: E-sign (medium)
7. **Contract e-sign flow** — publieke pagina met token-link waar medewerker contract kan bekijken en tekenen (zonder login)
8. **Onboarding wizard uitbreiden** — reglementen tonen en laten aftekenen tijdens onboarding

### Sprint 4: Dashboards (medium)
9. **Directie dashboard** — brutomarge, beschikbare kamers/voertuigen, omzet per opdrachtgever
10. **Recruiter KPI's** — plaatsingen, time-to-fill, conversieratio per recruiter

### Sprint 5: Huisvesting verbeteren (medium)
11. **Toewijzingslogica** — afstand-sortering, teamclustering in HousingSuggestionsCard
12. **EnergyWizard** — meterstanden tabel + invoer + grafieken

### Sprint 6-9: Koppelingen (groot)
13. E-mail integratie (Resend/SendGrid)
14. Nieuwsbriefmanager
15. WhatsApp AI-Chatbot
16. Flexpedia voorbereiding
17. Medewerker self-service PWA views
18. Vacaturepublicatie, CV refresh, VoIP

---

**Aanbevolen volgende stap:** Sprint 1 (Signalering) — kleinste scope, direct zichtbare waarde op het dashboard.

