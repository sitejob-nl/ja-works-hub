// Frontend-toegang tot de gedeelde validatie van de publieke profielaanvullink.
//
// De regels staan in supabase/functions/_shared/ omdat de edge function `candidate-profile`
// ze óók moet draaien (publiek endpoint → server valideert altijd zelf). We re-exporteren
// hier i.p.v. te kopiëren: twee kopieën van validatieregels lopen gegarandeerd uit elkaar.
// De module is puur en importvrij, dus Vite kan 'm gewoon bundelen.
export * from '../../supabase/functions/_shared/profile-validation.ts';
