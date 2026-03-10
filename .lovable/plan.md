

## Fix: Statische import in PortalLayout.tsx

**Probleem:** `PortalLayout.tsx` gebruikt een dynamische `await import()` voor de Supabase client, terwijl 80+ andere bestanden het statisch importeren. Vite behandelt deze mixed import als error.

**Wijziging in `src/components/layout/PortalLayout.tsx`:**

1. Voeg `import { supabase } from '@/integrations/supabase/client';` toe aan de imports bovenaan (regel 1-6)
2. Verwijder de dynamische import in `toggleLanguage` (regel 32: `const { supabase } = await import(...)`) en gebruik `supabase` direct

De functie `toggleLanguage` blijft `async` (vanwege de Supabase call), maar heeft geen `await import` meer nodig.

