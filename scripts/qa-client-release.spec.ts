import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ensureLoggedIn, kiesPaginagrootte } from './e2e-helpers';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);
const url = process.env.VITE_SUPABASE_URL!;
const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const org = process.env.DEMO_ORG_ID!;
const db = createClient(url, anon, { auth: { persistSession: false } });
const marker = 'QA-client-' + randomUUID().slice(0, 8);
const letters = Array.from({length:3}, () => 'BCDFGHJKLMNPRSTVWXYZ'[Math.floor(Math.random()*19)]).join('');
const plate = (n: number) => '8-' + letters + '-' + String(n).padStart(2, '0');
const ids: any = { vehicles: [], candidate: null, company: null, form: null, token: null, badToken: null, fields: {} };
let previousPause: any;
let pauseChanged = false;
const checked = async (query: any) => { const result = await query; if(result.error) throw new Error(result.error.message); return result.data; };
const add = (table: string, row: any) => checked(db.from(table as any).insert({organization_id:org, ...row}).select('id').single());
const out = process.env.QA_CLIENT_OUTPUT || 'scripts/.qa/client-release';
mkdirSync(out, {recursive:true});
const journal = () => writeFileSync(out + '/fixtures.json', JSON.stringify({marker, org, ids, previousPause, pauseChanged}, null, 2), { mode:0o600 });

test.beforeAll(async () => {
  expect(org).toBe('6dedabe4-f62c-479e-b5fc-ebfcb824d76f');
  await checked(db.auth.signInWithPassword({email:process.env.DEMO_ORG_EMAIL!,password:process.env.DEMO_ORG_PASSWORD!}));
  const profile = await checked(db.from('profiles').select('organization_id,role').eq('id', (await db.auth.getUser()).data.user!.id).single());
  expect(profile.organization_id).toBe(org); expect(profile.role).toBe('admin');
  const organization = await checked(db.from('organizations').select('settings').eq('id',org).single());
  previousPause = organization.settings?.outbound_paused;
  journal();
  await checked(db.from('organizations').update({settings:{...organization.settings,outbound_paused:{email:true,whatsapp:true}}}).eq('id',org));
  pauseChanged = true; journal();
  ids.candidate = (await add('candidates',{first_name:'QA',last_name:marker,has_drivers_license:true,drivers_license_expiry:'2030-01-01',employee_status:'actief',status:'werkzoekend'})).id; journal();
  ids.employee = (await add('employees',{candidate_id:ids.candidate,start_date:'2020-01-01',status:'actief'})).id;
  ids.company = (await add('companies',{name:marker})).id; journal();
  ids.vehicles = (await checked(db.from('vehicles').insert(Array.from({length:25},(_,i)=>({
    organization_id:org,license_plate:plate(i+1),brand:marker,model:'QA',year:2000+i,status:'beschikbaar',current_mileage:1000,notes:marker,
  }))).select('id'))).map((r:any)=>r.id); journal();
  ids.form = (await add('onboarding_forms',{name:marker,is_default:false,is_active:true})).id; journal();
  const step = (await add('onboarding_form_steps',{form_id:ids.form,title:'QA Gegevens',sort_order:0,is_active:true})).id;
  for (const [key,label,type,column] of [
    ['phone','Telefoon QA','tel','phone'], ['note','Voorkeur QA','textarea',null], ['dob','Geboortedatum QA','text','date_of_birth'],
  ]) ids.fields[key] = (await add('onboarding_form_fields',{step_id:step,label,field_type:type,sort_order:Object.keys(ids.fields).length,is_active:true,is_required:false,maps_to_table:column?'candidates':null,maps_to_column:column})).id;
  ids.token = randomUUID(); ids.badToken = randomUUID();
  await checked(db.from('onboarding_tokens').insert([ids.token,ids.badToken].map(token=>({organization_id:org,candidate_id:ids.candidate,form_id:ids.form,token,expires_at:new Date(Date.now()+3600000).toISOString()}))));
  journal();
});

test.afterAll(async () => {
  const failures: string[] = [];
  const clean = async (name:string, fn:()=>Promise<any>) => { try { await fn(); } catch { failures.push(name); } };
  if(ids.company) await clean('company documents',async()=>{
    const docs=await checked(db.from('documents').select('id,file_path').eq('organization_id',org).eq('company_id',ids.company));
    const paths=docs.map((d:any)=>d.file_path).filter(Boolean);
    if(paths.length) await checked(db.storage.from('documents').remove(paths));
    await checked(db.from('documents').delete().eq('organization_id',org).eq('company_id',ids.company));
  });
  if(ids.candidate) {
    await clean('onboarding tokens',()=>checked(db.from('onboarding_tokens').delete().eq('organization_id',org).eq('candidate_id',ids.candidate)));
    await clean('onboarding responses',()=>checked(db.from('onboarding_responses').delete().eq('organization_id',org).eq('candidate_id',ids.candidate)));
    await clean('candidate',()=>checked(db.rpc('delete_candidate_record',{p_candidate_id:ids.candidate,p_reason:'Opruimen eigen '+marker})));
  }
  if(ids.vehicles.length) {
    await clean('fines',()=>checked(db.from('vehicle_fines').delete().eq('organization_id',org).in('vehicle_id',ids.vehicles)));
    await clean('assignments',()=>checked(db.from('vehicle_assignments').delete().eq('organization_id',org).in('vehicle_id',ids.vehicles)));
  }
  await clean('vehicles',()=>checked(db.from('vehicles').delete().eq('organization_id',org).eq('brand',marker)));
  if(ids.company) await clean('company',()=>checked(db.from('companies').delete().eq('organization_id',org).eq('id',ids.company)));
  if(ids.form) await clean('form',()=>checked(db.from('onboarding_forms').delete().eq('organization_id',org).eq('id',ids.form)));
  if(pauseChanged) await clean('outbound pause',async()=>{
    const row=await checked(db.from('organizations').select('settings').eq('id',org).single());
    const settings={...row.settings};
    if(previousPause===undefined) delete settings.outbound_paused; else settings.outbound_paused=previousPause;
    await checked(db.from('organizations').update({settings}).eq('id',org));
    pauseChanged=false;
  });
  journal();
  expect(failures,'Alle eigen QA-records opruimen en communicatiepauze herstellen').toEqual([]);
});

test.beforeEach(async ({page}) => {
  if(process.env.QA_LOCAL_EDGE) await page.route('**/functions/v1/onboarding-submit*', async route => {
    const requestUrl = new URL(route.request().url());
    const response=await route.fetch({url:process.env.QA_LOCAL_EDGE + '/' + requestUrl.search});
    await route.fulfill({response});
  });
  await ensureLoggedIn(page);
});

test('kenteken normaliseert bij aanmaken en bewerken en wordt zo opgeslagen', async ({page})=>{
  await page.goto('/transport/new');
  await page.getByLabel('Kenteken *').fill(plate(90).replaceAll('-','').toLowerCase());
  await page.locator('label:has-text("Merk") + input').fill(marker);
  await expect(page.getByLabel('Kenteken *')).toHaveValue(plate(90));
  await page.getByRole('button',{name:'Voertuig aanmaken',exact:true}).click();
  await expect(page).toHaveURL(/\/transport\/[0-9a-f-]{36}$/);
  const id=page.url().split('/').at(-1)!; ids.vehicles.push(id); journal();
  expect((await checked(db.from('vehicles').select('license_plate').eq('id',id).single())).license_plate).toBe(plate(90));
  await page.goto('/transport/'+id+'/bewerken');
  await page.getByLabel('Kenteken *').fill('onvolledig');
  await expect(page.getByRole('button',{name:'Opslaan',exact:true})).toBeDisabled();
  await page.getByLabel('Kenteken *').fill(plate(91).replaceAll('-',' ').toLowerCase());
  await page.getByRole('button',{name:'Opslaan',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('/transport/'+id+'$'));
  expect((await checked(db.from('vehicles').select('license_plate').eq('id',id).single())).license_plate).toBe(plate(91));
  await page.screenshot({path:out+'/kenteken.png'});
});

test('historische autotoewijzing opslaan zonder de actuele voertuigstatus te wijzigen',async({page})=>{
  await page.goto('/transport/'+ids.vehicles[0]+'?tab=toewijzingen');
  await page.getByRole('tab',{name:'Toewijzingen',exact:true}).click();
  await page.getByRole('button',{name:'Voertuig toewijzen',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Voertuig toewijzen',exact:true});
  await dialog.getByRole('combobox').click();
  await page.getByPlaceholder('Zoek op naam of personeelsnummer...').fill(marker);
  await page.getByRole('option',{name:new RegExp(marker)}).click();
  await dialog.getByLabel('Startdatum *').fill('2020-01-01');
  await dialog.getByLabel('Inleverdatum (leeg = nog niet bekend)').fill('2020-05-01');
  await dialog.getByRole('button',{name:'Toewijzen',exact:true}).click();
  await expect(dialog).toBeHidden();
  const rows=await checked(db.from('vehicle_assignments').select('assigned_date,returned_date').eq('vehicle_id',ids.vehicles[0]));
  expect(rows).toEqual([{assigned_date:'2020-01-01',returned_date:'2020-05-01'}]);
  expect((await checked(db.from('vehicles').select('status').eq('id',ids.vehicles[0]).single())).status).toBe('beschikbaar');
  await page.screenshot({path:out+'/historische-toewijzing.png'});
});

test('autotoewijzing verwijderen vanuit medewerker vraagt eerst bevestiging',async({page})=>{
  const id=(await add('vehicle_assignments',{vehicle_id:ids.vehicles[1],employee_id:ids.employee,candidate_id:ids.candidate,assigned_date:'2021-01-01',returned_date:'2021-02-01'})).id;
  await page.goto('/kandidaten/'+ids.candidate+'?tab=transport');
  const row=page.locator('table tbody tr').filter({hasText:plate(2)});
  await row.getByRole('button',{name:'Toewijzing verwijderen'}).click();
  let dialog=page.getByRole('alertdialog');
  expect((await checked(db.from('vehicle_assignments').select('id').eq('id',id))).length).toBe(1);
  await dialog.getByRole('button',{name:'Annuleren'}).click();
  await expect(row).toBeVisible();
  await row.getByRole('button',{name:'Toewijzing verwijderen'}).click();
  dialog=page.getByRole('alertdialog');
  await dialog.getByRole('button',{name:'Verwijderen',exact:true}).click();
  await expect(row).toHaveCount(0);
  expect(await checked(db.from('vehicle_assignments').select('id').eq('id',id))).toEqual([]);
  await page.screenshot({path:out+'/medewerker-verwijderen.png'});
});

test('medewerker met huidige auto kan een afgesloten historische toewijzing toevoegen',async({page})=>{
  await add('vehicle_assignments',{vehicle_id:ids.vehicles[4],employee_id:ids.employee,candidate_id:ids.candidate,assigned_date:'2025-01-01'});
  await page.goto('/kandidaten/'+ids.candidate+'?tab=transport');
  await expect(page.getByRole('link',{name:plate(5),exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Voertuig toewijzen',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Voertuig toewijzen',exact:true});
  await dialog.getByLabel('Toewijsdatum *').fill('2022-01-01');
  await dialog.getByRole('combobox').click();
  await page.getByRole('option',{name:new RegExp(plate(4))}).click();
  const returned=dialog.locator('label:has-text("Inleverdatum") + input');
  await returned.fill('2021-12-31');
  await expect(dialog.getByRole('button',{name:'Toewijzen',exact:true})).toBeDisabled();
  await returned.fill('2022-02-01');
  await dialog.getByRole('button',{name:'Toewijzen',exact:true}).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading',{name:'Eerdere en geplande voertuigen'})).toBeVisible();
  await expect(page.locator('table tbody tr').filter({hasText:plate(4)})).toBeVisible();
  expect(await checked(db.from('vehicle_assignments').select('assigned_date,returned_date').eq('vehicle_id',ids.vehicles[3])))
    .toEqual([{assigned_date:'2022-01-01',returned_date:'2022-02-01'}]);
  expect((await checked(db.from('vehicles').select('status').eq('id',ids.vehicles[3]).single())).status).toBe('beschikbaar');
  await page.screenshot({path:out+'/medewerker-historie.png'});
});

test('boetestatus wijzigt op beide schermen pas na bevestigen',async({page})=>{
  const id=(await add('vehicle_fines',{vehicle_id:ids.vehicles[2],fine_date:'2026-01-01',amount:42.50,reference_number:marker,paid:false,photos:[]})).id;
  await page.goto('/transport/'+ids.vehicles[2]);
  await page.getByRole('tab',{name:'Boetes',exact:true}).click();
  let row=page.locator('table tbody tr').filter({hasText:marker});
  await row.getByText('Niet betaald',{exact:true}).click();
  expect((await checked(db.from('vehicle_fines').select('paid').eq('id',id).single())).paid).toBe(false);
  await page.getByRole('alertdialog').getByRole('button',{name:'Annuleren'}).click();
  await row.getByText('Niet betaald',{exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'Markeren als betaald',exact:true}).click();
  await expect(row.getByText('Betaald',{exact:true})).toBeVisible();
  expect((await checked(db.from('vehicle_fines').select('paid').eq('id',id).single())).paid).toBe(true);
  await page.goto('/transport');
  await page.getByRole('tab',{name:'Boetes',exact:true}).click();
  await page.getByPlaceholder('Zoek op kenteken, persoon, referentie...').fill(marker);
  await page.getByRole('combobox').click(); await page.getByRole('option',{name:'Alle boetes'}).click();
  row=page.locator('table tbody tr').filter({hasText:marker});
  await row.getByText('Betaald',{exact:true}).click();
  expect((await checked(db.from('vehicle_fines').select('paid').eq('id',id).single())).paid).toBe(true);
  await page.getByRole('alertdialog').getByRole('button',{name:'Markeren als niet betaald',exact:true}).click();
  await expect(row.getByText('Niet betaald',{exact:true})).toBeVisible();
  expect((await checked(db.from('vehicle_fines').select('paid').eq('id',id).single())).paid).toBe(false);
  await page.screenshot({path:out+'/boetes.png'});
});

test('inventarisatieformulier kan als documenttype worden opgeslagen',async({page})=>{
  await page.goto('/opdrachtgevers/'+ids.company);
  await page.getByRole('tab',{name:'Documenten',exact:true}).click();
  await page.getByRole('button',{name:/Document toevoegen|Nieuw document/}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('combobox').first().click();
  await page.getByRole('option',{name:'Inventarisatie-formulier',exact:true}).click();
  await dialog.locator('label:has-text("Naam") + input').fill(marker+' inventarisatie');
  await dialog.getByRole('button',{name:'Opslaan',exact:true}).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(marker+' inventarisatie',{exact:true})).toBeVisible();
  const doc=await checked(db.from('documents').select('company_document_type_id').eq('company_id',ids.company).single());
  const type=await checked(db.from('company_document_types').select('key').eq('id',doc.company_document_type_id).single());
  expect(type.key).toBe('inventarisatie_formulier');
  await page.screenshot({path:out+'/inventarisatie.png'});
});

test('sortering en 10/20/50 rijen werken over de volledige gefilterde set',async({page})=>{
  const vehicleCount=(await checked(db.from('vehicles').select('id').eq('organization_id',org).eq('brand',marker))).length;
  await page.goto('/transport');
  await page.getByPlaceholder('Zoek op kenteken, merk of model...').fill(marker);
  await expect(page.locator('table tbody tr')).toHaveCount(10);
  await page.getByRole('button',{name:'Bouwjaar',exact:true}).click();
  await expect(page.getByRole('columnheader',{name:'Bouwjaar'})).toHaveAttribute('aria-sort','descending');
  const lastYear=Number(await page.locator('table tbody tr td:nth-child(3)').last().innerText());
  await page.getByLabel('Ga naar de volgende pagina').click();
  await expect(page).toHaveURL(/page=2/);
  await expect.poll(async()=>Number(await page.locator('table tbody tr td:nth-child(3)').first().innerText())).toBeLessThanOrEqual(lastYear);
  for(const count of ['20','50','10']) {
    await kiesPaginagrootte(page,count);
    await expect(page.locator('table tbody tr')).toHaveCount(Math.min(Number(count),vehicleCount));
  }
  const years=await page.locator('table tbody tr td:nth-child(3)').allInnerTexts();
  expect(years.map(Number)).toEqual([...years.map(Number)].sort((a,b)=>b-a));
  await page.reload();
  await expect(page.getByRole('columnheader',{name:'Bouwjaar'})).toHaveAttribute('aria-sort','descending');
  await expect(page.getByLabel('Rijen per pagina')).toContainText('10');
  await expect(page.locator('table tbody tr')).toHaveCount(10);
  await page.screenshot({path:out+'/sortering.png'});
});

test('onboarding verwerkt gekoppelde gegevens en overige antwoorden in het profiel',async({page})=>{
  await page.goto('/onboarding/'+ids.token);
  await page.getByRole('button',{name:'Beginnen',exact:true}).click();
  await page.locator('[data-field-id="'+ids.fields.phone+'"] input').fill('+31600000001');
  await page.locator('[data-field-id="'+ids.fields.note+'"] textarea').fill(marker+' antwoord');
  await page.getByRole('button',{name:'Gegevens versturen',exact:true}).click();
  await expect(page.getByText('Je gegevens zijn succesvol verstuurd.')).toBeVisible();
  const candidate=await checked(db.from('candidates').select('phone,onboarding_completed').eq('id',ids.candidate).single());
  expect(candidate).toEqual({phone:'+31600000001',onboarding_completed:true});
  await page.goto('/kandidaten/'+ids.candidate+'?tab=profiel');
  const card=page.getByRole('region',{name:'Onboardingformulier',exact:true});
  await expect(card.getByText(marker+' antwoord',{exact:true})).toBeVisible();
  await expect(card.getByText('+31600000001',{exact:true})).toBeVisible();
  await card.screenshot({path:out+'/onboarding-profiel.png'});
});

test('onboarding meldt databasefouten en verbruikt een mislukte inzending niet',async({request})=>{
  const target=process.env.QA_LOCAL_EDGE || url+'/functions/v1/onboarding-submit';
  const result=await request.post(target,{headers:{apikey:anon,Authorization:'Bearer '+anon},data:{
    token:ids.badToken,form_id:ids.form,responses:{[ids.fields.dob]:'geen-datum'},
  }});
  expect(result.status()).toBe(500);
  expect((await result.json()).error).toContain('profielgegevens konden niet worden opgeslagen');
  const row=await checked(db.from('onboarding_tokens').select('used_at').eq('token',ids.badToken).single());
  expect(row.used_at).toBeNull();
});
