// Carerix document relabeler (onderhoudsfunctie).
//
// Bij de oorspronkelijke Carerix-import zijn veel documenten opgeslagen met een
// PLACEHOLDER-naam (patroon `^[0-9]+_[0-9a-f]+$`, bv. `73481_462cb2aa`) en
// bijna allemaal als type `overig`. Deze functie corrigeert dat: per document
// halen we ALLEEN de Carerix-attachment-METADATA opnieuw op (downloadName,
// displayName, label, attachmentMimeType — NADRUKKELIJK GEEN `content`) en
// werken `type` en waar mogelijk `name` bij.
//
// We downloaden NOOIT attachment-bytes opnieuw (3800+ files = te zwaar).
//
// Paginatie: offset-gebaseerd over een stabiele order (created_at, id). Hernoemde
// docs blijven `source='carerix'`, dus we kunnen niet op een veranderend veld
// filteren — het venster schuift puur op offset vooruit. `offset` wordt bij een
// self-trigger doorgegeven zodat een lange run hervat waar hij stopte.
//
// dry_run: berekent de sample (max SAMPLE_SIZE Carerix-calls) zonder iets te
// muteren en zonder self-trigger — bedoeld om eerst te zien wat Carerix teruggeeft.
//
// Failures worden gemarkeerd in `documents.notes` zodat ze niet eindeloos
// opnieuw worden geprobeerd.

import {
  corsHeaders,
  createAdminClient,
  getCallerProfile,
  jsonError,
  jsonOk,
  loadCarerixCredentials,
  runBackgroundTask,
} from '../_shared/carerix/helpers.ts';
import { internalFunctionHeaders, isServiceRoleRequest } from '../_shared/auth.ts';
import { fetchCarerixAccessToken } from '../_shared/carerix/auth.ts';
import { CarerixGraphQLClient } from '../_shared/carerix/client.ts';
import { crAttachmentMetaQuery } from '../_shared/carerix/queries.ts';
import { isCvType, mapDocumentType } from '../_shared/carerix/status-maps.ts';

const PAGE_SIZE = 100;
const SOFT_DEADLINE_MS = 75_000;
const FAIL_MARKER_PREFIX = '[carerix-relabel-failed:';
// Lichte delay tussen Carerix-calls (de client throttelt zelf al, dit is marge).
const CARERIX_CALL_DELAY_MS = 120;
// Hoeveel verwerkte docs we als diagnose-sample teruggeven (over de hele run).
const SAMPLE_SIZE = 15;
// Placeholder-naam zoals Carerix die liet staan: <cijfers>_<hex>.
const PLACEHOLDER_RE = /^[0-9]+_[0-9a-f]+$/;

interface DocRow {
  id: string;
  organization_id: string;
  name: string;
  type: string;
  notes: string | null;
  carerix_attachment_id: string;
}

interface CRAttachmentMeta {
  _id: string;
  downloadName?: string;
  displayName?: string;
  label?: string;
  attachmentMimeType?: string;
}

interface SampleEntry {
  document_id: string;
  old_name: string;
  downloadName: string | null;
  displayName: string | null;
  label: string | null;
  new_name: string | null;
  new_type: string | null;
}

function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return false;
  return PLACEHOLDER_RE.test(name.trim());
}

// Lichte substring-heuristiek voor documenttype o.b.v. de bestandsnaam, aanvullend
// op mapDocumentType (dat exact-match doet en bv. "ID Bartosz.jpg" mist). null = geen hit.
// Geeft alleen geldige document_type enum-waarden terug.
function guessDocType(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\bid\b|identiteit|\bidentity\b|paspoort|passport|id-?kaart|id bewijs|id oud|id nieuw/.test(t)) return 'id_bewijs';
  if (/rijbewijs|driver'?s? licen[cs]e|driving licen[cs]e/.test(t)) return 'rijbewijs';
  if (/loonstrook|payslip|salarisstrook/.test(t)) return 'loonstrook';
  if (/arbeidsovereenkomst|\bcontract\b/.test(t)) return 'contract';
  if (/diploma|certifica|getuigschrift/.test(t)) return 'certificaat';
  if (/reglement/.test(t)) return 'reglement';
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function selfTrigger(orgId: string, offset: number): Promise<void> {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/carerix-doc-relabel`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      ...internalFunctionHeaders(),
    },
    body: JSON.stringify({ organization_id: orgId, offset }),
  });

  if (!res.ok) {
    throw new Error(`relabel self-trigger failed (${res.status}): ${await res.text()}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('Method not allowed', 405);

  const started = Date.now();
  const admin = createAdminClient();

  const body = (await req.json().catch(() => ({}))) as {
    organization_id?: string;
    dry_run?: boolean;
    offset?: number;
  };
  const dryRun = body.dry_run === true;
  let offset = Number.isFinite(Number(body.offset)) ? Math.max(0, Math.floor(Number(body.offset))) : 0;

  let orgId = body.organization_id;
  if (isServiceRoleRequest(req)) {
    if (!orgId) return jsonError('organization_id is verplicht voor interne jobs', 400);
  } else {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonError('Ongeldige of ontbrekende sessie', 401);
    if (caller.profile.role !== 'admin') return jsonError('Alleen admins mogen Carerix-documenten relabelen', 403);
    orgId = caller.profile.organization_id;
  }
  if (!orgId) return jsonError('organization_id kon niet worden bepaald', 400);

  const creds = await loadCarerixCredentials(admin, orgId);
  if (!creds) return jsonError('Carerix-config niet gevonden voor organisatie', 404);

  let token: string;
  try {
    token = await fetchCarerixAccessToken(creds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(`Carerix OAuth mislukt: ${msg}`, 502);
  }
  const gql = new CarerixGraphQLClient(token);

  let totalProcessed = 0;
  let totalRenamed = 0;
  let totalRetyped = 0;
  let totalUnchanged = 0;
  let totalFailed = 0;
  let batchesRun = 0;
  const sample: SampleEntry[] = [];

  const summary = () => ({
    processed: totalProcessed,
    renamed: totalRenamed,
    retyped: totalRetyped,
    unchanged: totalUnchanged,
    failed: totalFailed,
    batches: batchesRun,
    next_offset: offset,
    sample,
  });

  while (true) {
    if (!dryRun && Date.now() - started > SOFT_DEADLINE_MS) {
      runBackgroundTask(selfTrigger(orgId, offset), 'carerix relabel self-trigger');
      return jsonOk({ ok: true, continued: true, ...summary() });
    }

    // Offset-paginatie over stabiele order. Hernoemde docs veranderen created_at/id
    // niet, dus de volgorde blijft stabiel en het venster schuift correct vooruit.
    const { data: docs, error: selErr } = await admin
      .from('documents')
      .select('id, organization_id, name, type, notes')
      .eq('source', 'carerix')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (selErr) return jsonError(`SELECT documents mislukt: ${selErr.message}`, 500);
    if (!docs || docs.length === 0) {
      return jsonOk({ ok: true, done: true, ...summary() });
    }

    const fetched = docs.length;

    // Placeholder-docs in dit venster (skip reeds-failed).
    const candidateRows: Array<Omit<DocRow, 'carerix_attachment_id'>> = [];
    for (const d of docs as Record<string, unknown>[]) {
      const name = (d.name as string | null) ?? '';
      const notes = (d.notes as string | null) ?? null;
      if (!isPlaceholderName(name)) continue;
      if (notes && notes.includes(FAIL_MARKER_PREFIX)) continue;
      candidateRows.push({
        id: d.id as string,
        organization_id: d.organization_id as string,
        name,
        type: (d.type as string) ?? 'overig',
        notes,
      });
    }

    offset += PAGE_SIZE; // venster schuift altijd vooruit

    if (candidateRows.length > 0) {
      const docIds = candidateRows.map((r) => r.id);
      const { data: mappings, error: mErr } = await admin
        .from('external_mappings')
        .select('entity_id, external_id')
        .eq('external_system', 'carerix')
        .eq('entity_type', 'document')
        .eq('organization_id', orgId)
        .in('entity_id', docIds);

      if (mErr) return jsonError(`SELECT mappings mislukt: ${mErr.message}`, 500);

      const mapByDocId = new Map<string, string>();
      for (const m of mappings ?? []) {
        mapByDocId.set(String(m.entity_id), String(m.external_id));
      }

      for (const c of candidateRows) {
        // In dry_run stoppen we zodra de sample vol is — houdt het goedkoop.
        if (dryRun && sample.length >= SAMPLE_SIZE) break;

        const carerixId = mapByDocId.get(c.id);
        if (!carerixId) {
          if (!dryRun) await markFailed(admin, c.id, c.notes, 'geen external_mapping voor dit document');
          totalFailed++;
          continue;
        }

        try {
          await sleep(CARERIX_CALL_DELAY_MS);
          const result = await gql.query<{ crAttachment: CRAttachmentMeta | null }>(
            crAttachmentMetaQuery(carerixId),
          );
          const att = result.crAttachment;
          if (!att) {
            if (!dryRun) await markFailed(admin, c.id, c.notes, 'attachment niet gevonden in Carerix');
            totalFailed++;
            continue;
          }

          const downloadName = att.downloadName ?? null;
          const displayName = att.displayName ?? null;
          const label = att.label ?? null;

          // BELANGRIJK: Carerix' downloadName is hier juist de placeholder (<id>_<hex>);
          // de ECHTE bestandsnaam zit in displayName (bv. "CV - Jan.pdf", "ID oud").
          // We negeren downloadName voor naamgeving + type en gebruiken displayName.
          const realName = displayName && !isPlaceholderName(displayName) ? displayName.trim() : '';

          // Type bepalen o.b.v. displayName + label (NIET de placeholder).
          // CV-detectie expliciet via isCvType (mapDocumentType mapt 'cv' NAAR 'overig').
          let newType: string;
          if (isCvType(displayName) || isCvType(label)) {
            newType = 'cv';
          } else {
            const guessed = guessDocType(displayName) ?? guessDocType(label);
            const mapped = mapDocumentType(label);
            newType = guessed ?? (mapped !== 'overig' ? mapped : c.type);
          }

          // Naam alleen wijzigen als de huidige naam een placeholder is EN we een
          // echte bron-naam (displayName) hebben.
          const sourceName = realName;
          const shouldRename = isPlaceholderName(c.name) && sourceName.length > 0;

          const patch: { name?: string; type?: string } = {};
          if (shouldRename) patch.name = sourceName;
          if (newType !== c.type) patch.type = newType;

          const willRename = patch.name !== undefined;
          const willRetype = patch.type !== undefined;

          if (sample.length < SAMPLE_SIZE) {
            sample.push({
              document_id: c.id,
              old_name: c.name,
              downloadName,
              displayName,
              label,
              new_name: willRename ? patch.name! : null,
              new_type: willRetype ? patch.type! : null,
            });
          }

          if (!willRename && !willRetype) {
            totalUnchanged++;
            totalProcessed++;
            continue;
          }

          if (!dryRun) {
            const { error: updErr } = await admin
              .from('documents')
              .update(patch)
              .eq('id', c.id)
              .eq('organization_id', c.organization_id);
            if (updErr) {
              await markFailed(admin, c.id, c.notes, `db-update: ${updErr.message}`);
              totalFailed++;
              continue;
            }
          }

          if (willRename) totalRenamed++;
          if (willRetype) totalRetyped++;
          totalProcessed++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!dryRun) await markFailed(admin, c.id, c.notes, msg.slice(0, 200));
          totalFailed++;
        }
      }
    }

    batchesRun++;

    // dry_run: één venster (of tot sample vol) en klaar — geen mutatie, geen self-trigger.
    if (dryRun) {
      return jsonOk({ ok: true, dry_run: true, scanned_window: fetched, ...summary() });
    }

    // Venster niet vol → einde van de dataset bereikt.
    if (fetched < PAGE_SIZE) {
      return jsonOk({ ok: true, done: true, ...summary() });
    }
  }
});

async function markFailed(
  admin: ReturnType<typeof createAdminClient>,
  documentId: string,
  existingNotes: string | null,
  reason: string,
): Promise<void> {
  const marker = `${FAIL_MARKER_PREFIX}${reason.slice(0, 200)}]`;
  const newNotes = existingNotes
    ? `${existingNotes}\n${marker}`.slice(0, 2000)
    : marker;
  await admin.from('documents').update({ notes: newNotes }).eq('id', documentId);
}
