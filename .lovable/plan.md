

## Sidebar reorganisatie

De sidebar heeft nu 18+ items in een platte lijst. Plan: groepeer ze in logische secties met subtiele groepslabels.

### Groepering

```text
─────────────────────
[Logo]
─────────────────────
Dashboard
Workbench

── RELATIES ──────────
Opdrachtgevers
Kandidaten
Medewerkers

── WERK ──────────────
Vacatures
Planning
Uren

── VASTGOED & FLEET ──
Huisvesting
Transport
Tankpas analyse

── COMMUNICATIE ───────
Communicatie
WhatsApp
Bulk Campagnes

── TOOLS ─────────────
Kennisbank
Vacaturebank
Kandidaten zoeken
Exact Online

─────────────────────
Instellingen
[User]
[Inklappen]
─────────────────────
```

### Implementatie

**Bestand:** `src/components/layout/AppSidebar.tsx`

1. Verander `allNavItems` van een platte array naar een gegroepeerde structuur:
   ```ts
   const navGroups = [
     { label: null, items: [Dashboard, Workbench] },
     { label: 'Relaties', items: [Opdrachtgevers, Kandidaten, Medewerkers] },
     { label: 'Werk', items: [Vacatures, Planning, Uren] },
     { label: 'Vastgoed & Fleet', items: [Huisvesting, Transport, Tankpas analyse] },
     { label: 'Communicatie', items: [Communicatie, WhatsApp, Bulk Campagnes] },
     { label: 'Tools', items: [Kennisbank, Vacaturebank, Kandidaten zoeken, Exact Online] },
   ];
   ```

2. Filter per groep op `isModuleEnabled`, en verberg lege groepen volledig.

3. Render per groep: een klein uppercase label (muted, `text-[10px] font-semibold uppercase tracking-wider`) gevolgd door de nav items. Label verborgen als `collapsed`. Eerste groep (Dashboard/Workbench) heeft geen label.

4. Voeg `mt-4` toe voor elke groep met label, zodat er visuele scheiding is zonder horizontale lijnen.

Geen andere bestanden worden gewijzigd. Alleen de rendering-logica en datastructuur van de sidebar.

