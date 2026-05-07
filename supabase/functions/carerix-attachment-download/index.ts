// Carerix attachment-byte downloader.
//
// Werkt los van de sync-worker: pakt batches van `documents` waar
// source='carerix' en file_path NULL is, haalt per item de base64-content op
// via crAttachment(_id), uploadt naar de `documents` storage-bucket en
// schrijft `file_path` terug.
//
// Failures worden gemarkeerd in `documents.notes` zodat ze niet eindeloos
// opnieuw worden geprobeerd. Self-trigger pattern voor lange runs.

import {
  corsHeaders,
  createAdminClient,
  getCallerProfile,
  jsonError,
  jsonOk,
  loadCarerixCredentials,
} from '../_shared/carerix/helpers.ts';
import { isServiceRoleRequest } from '../_shared/auth.ts';
import { fetchCarerixAccessToken } from '../_shared/carerix/auth.ts';
import { CarerixGraphQLClient } from '../_shared/carerix/client.ts';
import { crAttachmentByIdQuery } from '../_shared/carerix/queries.ts';
import { isCvType } from '../_shared/carerix/status-maps.ts';

const BATCH_SIZE = 25;
const SOFT_DEADLINE_MS = 75_000;
const FAIL_MARKER_PREFIX = '[carerix-bytes-failed:';

interface DocRow {
  id: string;
  candidate_id: string;
  organization_id: string;
  name: string;
  notes: string | null;
  carerix_attachment_id: string;
}

interface CRAttachmentFull {
  _id: string;
  downloadName?: string;
  displayName?: string;
  attachmentMimeType?: string;
  label?: string;
  attachmentSize?: number;
  content?: string;
}

function selfTrigger(orgId: string): Promise<Response> {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/carerix-attachment-download`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({ organization_id: orgId }),
  });
}

// Map Carerix downloadName / mimeType naar een file extensie.
function pickExtension(att: CRAttachmentFull, fallbackName?: string): string {
  const name = att.downloadName ?? att.displayName ?? fallbackName ?? '';
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex > 0 && dotIndex < name.length - 1) {
    const ext = name.substring(dotIndex + 1).toLowerCase();
    if (/^[a-z0-9]{1,8}$/.test(ext)) return ext;
  }
  const mime = (att.attachmentMimeType ?? '').toLowerCase();
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('msword')) return 'doc';
  if (mime.includes('officedocument.wordprocessingml')) return 'docx';
  if (mime.includes('spreadsheetml') || mime.includes('excel')) return 'xlsx';
  return 'bin';
}

function base64ToUint8Array(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('Method not allowed', 405);

  const started = Date.now();
  const admin = createAdminClient();

  const body = (await req.json().catch(() => ({}))) as { organization_id?: string };
  let orgId = body.organization_id;
  if (isServiceRoleRequest(req)) {
    if (!orgId) return jsonError('organization_id is verplicht voor interne jobs', 400);
  } else {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonError('Ongeldige of ontbrekende sessie', 401);
    if (caller.profile.role !== 'admin') return jsonError('Alleen admins mogen Carerix-bijlagen downloaden', 403);
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

  let totalDownloaded = 0;
  let totalFailed = 0;
  const totalSkipped = 0;
  let batchesRun = 0;

  while (true) {
    if (Date.now() - started > SOFT_DEADLINE_MS) {
      selfTrigger(orgId).catch(() => {});
      return jsonOk({
        ok: true,
        continued: true,
        downloaded: totalDownloaded,
        failed: totalFailed,
        skipped: totalSkipped,
        batches: batchesRun,
      });
    }

    // Pak een batch documenten zonder file_path (Carerix). We fetchen meer dan
    // BATCH_SIZE en filteren reeds-failed in JS uit (PostgREST .or() met
    // notes.like-patroon is broos vanwege special chars in de marker-prefix).
    // Geen FK tussen documents en external_mappings (polymorphic op entity_id),
    // dus 2 aparte queries en in-JS join.
    const FETCH_LIMIT = BATCH_SIZE * 4;
    const { data: docs, error: selErr } = await admin
      .from('documents')
      .select('id, candidate_id, organization_id, name, notes')
      .eq('source', 'carerix')
      .eq('organization_id', orgId)
      .is('file_path', null)
      .order('created_at', { ascending: true })
      .limit(FETCH_LIMIT);

    if (selErr) return jsonError(`SELECT documents mislukt: ${selErr.message}`, 500);
    if (!docs || docs.length === 0) {
      return jsonOk({
        ok: true,
        done: true,
        downloaded: totalDownloaded,
        failed: totalFailed,
        skipped: totalSkipped,
        batches: batchesRun,
      });
    }

    // Prefilter failed eerst, daarna mappings ophalen voor de overgebleven IDs.
    const candidateRows: Array<Omit<DocRow, 'carerix_attachment_id'>> = [];
    let prefilteredFailed = 0;
    for (const d of docs as Record<string, unknown>[]) {
      const notes = (d.notes as string | null) ?? null;
      if (notes && notes.includes(FAIL_MARKER_PREFIX)) {
        prefilteredFailed++;
        continue;
      }
      candidateRows.push({
        id: d.id as string,
        candidate_id: d.candidate_id as string,
        organization_id: d.organization_id as string,
        name: (d.name as string) ?? '',
        notes,
      });
      if (candidateRows.length >= BATCH_SIZE) break;
    }

    if (candidateRows.length === 0) {
      return jsonOk({
        ok: true,
        done: true,
        downloaded: totalDownloaded,
        failed: totalFailed,
        skipped: totalSkipped + prefilteredFailed,
        note: 'alle resterende docs zijn al als failed gemarkeerd',
      });
    }

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

    const rows: DocRow[] = [];
    for (const c of candidateRows) {
      const carerixId = mapByDocId.get(c.id);
      if (!carerixId) {
        // Document zonder mapping — kunnen we niets mee. Markeer en verder.
        await markFailed(admin, c.id, c.notes, 'geen external_mapping voor dit document');
        totalFailed++;
        continue;
      }
      rows.push({ ...c, carerix_attachment_id: carerixId });
    }

    if (rows.length === 0) {
      // Alle rijen waren al gemarkeerd of misten een mapping — herhaal pull.
      continue;
    }

    for (const row of rows) {
      try {
        const result = await gql.query<{ crAttachment: CRAttachmentFull | null }>(
          crAttachmentByIdQuery(row.carerix_attachment_id),
        );
        const att = result.crAttachment;
        if (!att) {
          await markFailed(admin, row.id, row.notes, 'attachment niet gevonden in Carerix');
          totalFailed++;
          continue;
        }
        if (!att.content) {
          await markFailed(admin, row.id, row.notes, 'geen content (mogelijk niet-downloadbaar)');
          totalFailed++;
          continue;
        }

        const ext = pickExtension(att, row.name);
        const bytes = base64ToUint8Array(att.content);
        const path = `${row.organization_id}/${row.candidate_id}/${row.id}.${ext}`;

        const { error: upErr } = await admin.storage
          .from('documents')
          .upload(path, bytes, {
            contentType: att.attachmentMimeType ?? 'application/octet-stream',
            upsert: true,
          });
        if (upErr) {
          await markFailed(admin, row.id, row.notes, `upload: ${upErr.message}`);
          totalFailed++;
          continue;
        }

        const newName = att.downloadName || att.displayName || row.name;
        const { error: updErr } = await admin
          .from('documents')
          .update({ file_path: path, name: newName })
          .eq('id', row.id);
        if (updErr) {
          // Storage object is wel geupload; markeer voor handmatige cleanup.
          await markFailed(
            admin,
            row.id,
            row.notes,
            `db-update na upload: ${updErr.message}`,
          );
          totalFailed++;
          continue;
        }

        const isPdfCv = ext === 'pdf' && (isCvType(att.label) || isCvType(newName) || isCvType(row.name));
        if (isPdfCv) {
          const { data: urlData } = admin.storage.from('documents').getPublicUrl(path);
          if (urlData.publicUrl) {
            await admin
              .from('candidates')
              .update({ cv_file_url: urlData.publicUrl })
              .eq('id', row.candidate_id)
              .eq('organization_id', row.organization_id)
              .is('cv_file_url', null);
          }
        }

        totalDownloaded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // GraphQL/network errors → markeer en ga door.
        await markFailed(admin, row.id, row.notes, msg.slice(0, 200));
        totalFailed++;
      }
    }

    batchesRun++;
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
