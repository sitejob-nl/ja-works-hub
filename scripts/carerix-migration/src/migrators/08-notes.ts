import type { MigrationContext, CRToDo } from '../types/carerix.js';

const ENTITY_TYPE_NOTE = 'note';
const ENTITY_TYPE_TASK = 'task';

const FIELDS = `
  _id subject description notes
  dueDate completedDate
  status type
  toEmployee { _id }
  toCompany { _id }
  toContact { _id }
`;

function buildQuery(pageNumber: number, pageSize: number): string {
  return `query {
    crToDoPage(pageNumber: ${pageNumber}, pageSize: ${pageSize}) {
      totalElements
      items { ${FIELDS} }
    }
  }`;
}

function resolveEntity(
  todo: CRToDo,
  idMapper: MigrationContext['idMapper'],
): { entityType: string; entityId: string } | null {
  if (todo.toEmployee?._id) {
    const id = idMapper.getJaWerktId('candidate', String(todo.toEmployee._id));
    if (id) return { entityType: 'candidate', entityId: id };
  }
  if (todo.toCompany?._id) {
    const id = idMapper.getJaWerktId('company', String(todo.toCompany._id));
    if (id) return { entityType: 'company', entityId: id };
  }
  if (todo.toContact?._id) {
    const id = idMapper.getJaWerktId('contact', String(todo.toContact._id));
    if (id) return { entityType: 'contact', entityId: id };
  }
  return null;
}

function isTask(todo: CRToDo): boolean {
  const type = (todo.type || '').toLowerCase();
  return type === 'task' || type === 'meeting' || type === 'campaign' || !!todo.dueDate;
}

export async function migrateNotes(ctx: MigrationContext): Promise<void> {
  const { carerixClient, supabase, idMapper, logger, progress, config } = ctx;

  progress.startEntity('notes');
  logger.info('Starting notes/tasks migration...');

  // We need a created_by UUID. Use the first admin profile in this org.
  let createdBy: string | null = null;
  if (!config.dryRun) {
    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('organization_id', config.organizationId)
      .eq('role', 'admin')
      .limit(1)
      .single();

    createdBy = adminProfile?.id || null;
    if (!createdBy) {
      logger.warn('No admin profile found — notes.created_by will need manual fix');
    }
  }

  let noteCount = 0;
  let taskCount = 0;

  for await (const todo of carerixClient.paginateAll<CRToDo>(
    buildQuery,
    (data) => data.crToDoPage,
  )) {
    const carerixId = String(todo._id);
    const entity = resolveEntity(todo, idMapper);

    if (!entity) {
      logger.debug(`ToDo ${carerixId} has no linked entity in JA Werkt, skipping`);
      progress.recordSkip('notes');
      continue;
    }

    if (isTask(todo)) {
      // Import as recruiter_task
      taskCount++;
      if (idMapper.getJaWerktId(ENTITY_TYPE_TASK, carerixId)) {
        progress.recordSkip('notes');
        continue;
      }

      try {
        const mapped = {
          title: todo.subject || 'Taak uit Carerix',
          description: [todo.description, todo.notes].filter(Boolean).join('\n\n') || null,
          status: todo.completedDate ? 'done' : 'todo',
          priority: 'medium',
          due_date: todo.dueDate || null,
          completed_at: todo.completedDate || null,
          related_entity_type: entity.entityType,
          related_entity_id: entity.entityId,
          organization_id: config.organizationId,
          ai_generated: false,
        };

        if (config.dryRun) {
          logger.debug(`[DRY-RUN] Would create task: ${mapped.title}`, { carerixId });
          progress.recordCreate('notes');
          continue;
        }

        const { data: inserted, error } = await supabase
          .from('recruiter_tasks')
          .insert(mapped)
          .select('id')
          .single();

        if (error) throw new Error(error.message);

        await idMapper.saveMapping(ENTITY_TYPE_TASK, inserted.id, carerixId);
        progress.recordCreate('notes');
      } catch (err: any) {
        logger.error(`Failed to import task ${carerixId}`, { error: err.message });
        progress.recordFailure('notes', carerixId, err.message);
      }
    } else {
      // Import as note
      noteCount++;
      if (idMapper.getJaWerktId(ENTITY_TYPE_NOTE, carerixId)) {
        progress.recordSkip('notes');
        continue;
      }

      try {
        const body = [todo.subject, todo.description, todo.notes]
          .filter(Boolean)
          .join('\n\n') || 'Notitie uit Carerix';

        const mapped = {
          body,
          related_entity_type: entity.entityType,
          related_entity_id: entity.entityId,
          organization_id: config.organizationId,
          is_internal: true,
          created_by: createdBy || '00000000-0000-0000-0000-000000000000',
        };

        if (config.dryRun) {
          logger.debug(`[DRY-RUN] Would create note`, { carerixId });
          progress.recordCreate('notes');
          continue;
        }

        const { data: inserted, error } = await supabase
          .from('notes')
          .insert(mapped)
          .select('id')
          .single();

        if (error) throw new Error(error.message);

        await idMapper.saveMapping(ENTITY_TYPE_NOTE, inserted.id, carerixId);
        progress.recordCreate('notes');
      } catch (err: any) {
        logger.error(`Failed to import note ${carerixId}`, { error: err.message });
        progress.recordFailure('notes', carerixId, err.message);
      }
    }
  }

  progress.setFound('notes', noteCount + taskCount);
  progress.endEntity('notes');
  logger.info(`Notes migration complete: ${noteCount} notes, ${taskCount} tasks`);
}
