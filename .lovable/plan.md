

## Plan: Vacaturebank & Kandidaten Zoeken toevoegen aan module-lijst

De `ALL_MODULES` array in `SuperAdminOrganizations.tsx` mist `vacaturebank` en `kandidaten-zoeken`. Hierdoor kunnen superadmins deze modules niet per organisatie aan/uit zetten.

### Wijzigingen

| Bestand | Wat |
|---------|-----|
| `src/pages/superadmin/SuperAdminOrganizations.tsx` | Twee items toevoegen aan `ALL_MODULES`: `{ key: 'vacaturebank', label: 'Vacaturebank' }` en `{ key: 'kandidaten-zoeken', label: 'Kandidaten zoeken' }` |

De sidebar (`AppSidebar.tsx`) filtert al op `moduleKey`, dus zodra een superadmin de module uitzet verdwijnt het menu-item automatisch. `kandidaten-zoeken` gebruikt momenteel `moduleKey: 'kandidaten'` — dit moet aangepast worden naar `'kandidaten-zoeken'` zodat het onafhankelijk van de kandidaten-module aan/uit gezet kan worden.

| Bestand | Wat |
|---------|-----|
| `src/components/layout/AppSidebar.tsx` | `moduleKey` van "Kandidaten zoeken" wijzigen van `'kandidaten'` naar `'kandidaten-zoeken'` |

