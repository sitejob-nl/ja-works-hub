import pLimit from 'p-limit';
import type { MigrationContext, CREmployee, CRAttachment } from '../types/carerix.js';
import { mapDocumentType, isCvType } from '../lib/status-maps.js';

const ENTITY_TYPE = 'document';
const UPLOAD_CONCURRENCY = 3;

const FIELDS = `
  _id firstName lastName
  attachments {
    items {
      _id filePath label
      content
      toTypeNode { _id value }
    }
  }
`;

function buildQuery(pageNumber: number, pageSize: number): string {
  return `query {
    crEmployeePage(pageNumber: ${pageNumber}, pageSize: ${pageSize}) {
      totalElements
      items { ${FIELDS} }
    }
  }`;
}

function sanitizeFilename(filePath: string): string {
  return filePath
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 200);
}

function guessContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    txt: 'text/plain',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return types[ext || ''] || 'application/octet-stream';
}

async function processAttachment(
  ctx: MigrationContext,
  candidateJaWerktId: string,
  attachment: CRAttachment,
): Promise<void> {
  const { supabase, idMapper, logger, progress, config } = ctx;
  const carerixId = String(attachment._id);

  if (idMapper.getJaWerktId(ENTITY_TYPE, carerixId)) {
    progress.recordSkip('documents');
    return;
  }

  if (!attachment.content) {
    logger.warn(`Attachment ${carerixId} has no content, skipping`);
    progress.recordSkip('documents');
    return;
  }

  const fileName = sanitizeFilename(attachment.filePath || `attachment_${carerixId}`);
  const storagePath = `${config.organizationId}/${candidateJaWerktId}/${carerixId}_${fileName}`;
  const typeValue = attachment.toTypeNode?.value || '';
  const docType = mapDocumentType(typeValue);
  const contentType = guessContentType(fileName);

  if (config.dryRun) {
    logger.debug(`[DRY-RUN] Would upload document: ${fileName}`, { carerixId, docType });
    progress.recordCreate('documents');
    return;
  }

  // Decode base64 and upload to Supabase Storage
  const buffer = Buffer.from(attachment.content, 'base64');

  const { error: uploadError } = await supabase.storage
    .from(config.storageBucket)
    .upload(storagePath, buffer, {
      contentType,
      upsert: false,
    });

  if (uploadError && !uploadError.message.includes('already exists')) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(config.storageBucket)
    .getPublicUrl(storagePath);

  const fileUrl = urlData.publicUrl;

  // Insert document record
  const { data: inserted, error: insertError } = await supabase
    .from('documents')
    .insert({
      candidate_id: candidateJaWerktId,
      type: docType,
      file_url: fileUrl,
      file_name: attachment.label || fileName,
      status: 'geldig',
      organization_id: config.organizationId,
    })
    .select('id')
    .single();

  if (insertError) throw new Error(`Document insert failed: ${insertError.message}`);

  await idMapper.saveMapping(ENTITY_TYPE, inserted.id, carerixId);

  // If this is a CV, update the candidate's cv_file_url
  if (isCvType(typeValue)) {
    await supabase
      .from('candidates')
      .update({ cv_file_url: fileUrl })
      .eq('id', candidateJaWerktId);

    logger.debug(`Updated cv_file_url for candidate ${candidateJaWerktId}`);
  }

  progress.recordCreate('documents');
  logger.debug(`Uploaded document: ${fileName}`, { carerixId, docType, size: buffer.length });
}

export async function migrateDocuments(ctx: MigrationContext): Promise<void> {
  const { carerixClient, logger, progress, idMapper } = ctx;

  progress.startEntity('documents');
  logger.info('Starting documents migration...');

  const limit = pLimit(UPLOAD_CONCURRENCY);
  let totalDocs = 0;

  for await (const employee of carerixClient.paginateAll<CREmployee>(
    buildQuery,
    (data) => data.crEmployeePage,
  )) {
    const candidateId = idMapper.getJaWerktId('candidate', String(employee._id));
    if (!candidateId) {
      logger.warn(`Candidate ${employee._id} not in mappings, skipping documents`);
      continue;
    }

    const attachments = employee.attachments?.items || [];
    if (attachments.length === 0) continue;

    totalDocs += attachments.length;

    // Process attachments for this candidate with concurrency limit
    const tasks = attachments.map(att =>
      limit(async () => {
        try {
          await processAttachment(ctx, candidateId, att);
        } catch (err: any) {
          logger.error(`Failed to import document ${att._id}`, { error: err.message });
          progress.recordFailure('documents', String(att._id), err.message, {
            candidateId,
            fileName: att.filePath,
          });
        }
      }),
    );

    await Promise.all(tasks);
  }

  progress.setFound('documents', totalDocs);
  progress.endEntity('documents');
  logger.info(`Documents migration complete: ${totalDocs} found`);
}
