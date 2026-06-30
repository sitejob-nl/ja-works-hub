import { describe, expect, it } from 'vitest';
import {
  createCandidateScreeningFollowupTask,
  getCandidateScreeningOpenItems,
  getInitialData,
  getProfileDraft,
  prepareCandidateScreeningSave,
  saveCandidateScreening,
  startCandidateScreeningReanalysis,
  validateCandidateScreeningCompletion,
  type CandidateScreeningCandidate,
  type CandidateScreeningFollowupTask,
} from '@/lib/candidateScreening';

const candidate: CandidateScreeningCandidate = {
  id: 'candidate-1',
  organization_id: 'org-1',
  first_name: 'Anna',
  last_name: 'Kowalska',
  status: 'nieuw',
  phone_nl: '0612345678',
  email: 'anna@example.com',
  nationality: 'Pools',
  skills: ['MIG/MAG lassen'],
  certifications: ['VCA'],
  available_from: '2026-07-15',
  availability_notes: 'Beschikbaar vanaf: 2026-07-01\nEigen notitie blijft staan',
  ai_interview_questions: ['Welke machines heb je gebruikt?'],
};

describe('candidate screening workflow', () => {
  it('bouwt draft en belmenu vanuit kandidaatfeiten', () => {
    const data = getInitialData(candidate);
    const draft = getProfileDraft(candidate);

    expect(data.status).toBe('niet_gestart');
    expect(data.answers.phone_reachable.asked).toBe(true);
    expect(data.answers.experience_summary.notes).toContain('MIG/MAG lassen');
    expect(data.answers.prep_cv_check.notes).toContain('Welke machines heb je gebruikt?');
    expect(draft.availability_notes).toBe('Eigen notitie blijft staan');
  });

  it('bereidt concept en afronden met centrale statusregels voor', () => {
    const data = {
      ...getInitialData(candidate),
      status: 'in_gesprek' as const,
      result: 'goedgekeurd',
      summary: 'Sterke kandidaat voor productie en laswerk.',
      answers: {
        ...getInitialData(candidate).answers,
        critical_unknowns: { asked: true, notes: 'Geen kritieke onbekenden.' },
      },
    };
    const profileDraft = {
      ...getProfileDraft(candidate),
      date_of_birth: '1994-03-12',
    };

    const concept = prepareCandidateScreeningSave({
      candidate,
      data,
      profileDraft,
      timestamp: '2026-07-01T10:00:00.000Z',
    });
    expect(concept.screeningData.status).toBe('concept_opgeslagen');
    expect(concept.updates.status).toBe('in_screening');
    expect(concept.updates.screened_at).toBeUndefined();

    const completed = prepareCandidateScreeningSave({
      candidate,
      data,
      profileDraft,
      complete: true,
      userId: 'user-1',
      timestamp: '2026-07-01T10:05:00.000Z',
    });
    expect(completed.screeningData.status).toBe('afgerond');
    expect(completed.updates.status).toBe('werkzoekend');
    expect(completed.updates.screened_by).toBe('user-1');
    expect(completed.completionNote?.body).toContain('Screening voltooid');
  });

  it('valideert afronden en stuurt ontbrekende kernvelden naar besluit', () => {
    const data = {
      ...getInitialData({ ...candidate, phone_nl: null, email: null, skills: [] }),
      result: 'goedgekeurd',
      summary: 'Akkoord ondanks open punten.',
    };
    const profileDraft = {
      ...getProfileDraft({ ...candidate, phone_nl: null, email: null, skills: [] }),
      nationality: '',
      skills: [],
    };

    const blocked = validateCandidateScreeningCompletion(data, profileDraft);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.focusStep).toBe('besluit');
      expect(blocked.message).toContain('telefoonnummer');
    }

    const allowed = validateCandidateScreeningCompletion({
      ...data,
      answers: {
        ...data.answers,
        critical_unknowns: { asked: true, notes: 'Recruiter accepteert ontbrekende velden tijdelijk.' },
      },
    }, profileDraft);
    expect(allowed.ok).toBe(true);
  });

  it('maakt follow-up taken via een substitueerbare poort', async () => {
    const data = getInitialData({ ...candidate, phone_nl: null });
    const openItems = getCandidateScreeningOpenItems(data, [{ label: 'Telefoonnummer' }]);
    const inserted: CandidateScreeningFollowupTask[] = [];

    const task = await createCandidateScreeningFollowupTask({
      ports: { insertFollowupTask: async (payload) => { inserted.push(payload); } },
      candidate,
      userId: 'user-1',
      openItems,
    });

    expect(inserted).toEqual([task]);
    expect(task.title).toBe('Screening opvolgen: Anna Kowalska');
    expect(task.priority).toBe('high');
    expect(task.description).toContain('Profiel: Telefoonnummer');
  });

  it('laat een mislukte voltooiingsnotitie de save niet breken', async () => {
    const data = {
      ...getInitialData(candidate),
      status: 'in_gesprek' as const,
      result: 'afgekeurd',
      summary: 'Niet passend op dit moment.',
    };
    const updates: Record<string, unknown>[] = [];

    const result = await saveCandidateScreening({
      ports: {
        updateCandidate: async (_candidateId, payload) => { updates.push(payload); },
        insertCompletionNote: async () => { throw new Error('notes offline'); },
      },
      candidate,
      data,
      profileDraft: getProfileDraft(candidate),
      complete: true,
      userId: 'user-1',
    });

    expect(updates).toHaveLength(1);
    expect(result.screeningData.status).toBe('afgekeurd');
    expect(result.completionNoteCreated).toBe(false);
    expect(result.completionNoteError).toBeInstanceOf(Error);
  });

  it('wacht en retryt AI-heranalyse wanneer de vorige analyse nog loopt', async () => {
    const statuses = ['analyzing', 'idle', 'idle'];
    const sleeps: number[] = [];
    let starts = 0;

    await startCandidateScreeningReanalysis({
      ports: {
        getCandidateAiStatus: async () => statuses.shift(),
        startCandidateAnalysis: async () => {
          starts += 1;
          if (starts === 1) throw new Error('Analyse loopt al');
        },
        sleep: async (ms) => { sleeps.push(ms); },
      },
      candidateId: candidate.id,
    });

    expect(starts).toBe(2);
    expect(sleeps).toEqual([3000]);
  });
});
