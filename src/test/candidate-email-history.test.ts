import { describe, expect, it } from 'vitest';
import {
  buildOutlookParticipantSearch,
  mergeCandidateHistory,
  normalizeCandidateEmail,
  type CandidateCommunicationRecord,
  type CandidateOutlookMessage,
} from '@/lib/candidate-email-history';

const outlookMessage = (overrides: Partial<CandidateOutlookMessage> = {}): CandidateOutlookMessage => ({
  id: 'graph-1',
  account_id: 'mailbox-1',
  mailbox_label: 'Recruitment',
  mailbox_email: 'recruitment@example.com',
  subject: 'Kennismaking',
  preview: 'Bedankt voor je bericht',
  from: { address: 'candidate@example.com' },
  to: [{ address: 'recruitment@example.com' }],
  received_at: '2026-07-26T10:00:00.000Z',
  sent_at: '2026-07-26T10:00:00.000Z',
  ...overrides,
});

const communication = (overrides: Partial<CandidateCommunicationRecord> = {}): CandidateCommunicationRecord => ({
  id: 'communication-1',
  channel: 'email',
  subject: 'Kennismaking',
  body: 'Bedankt voor je bericht',
  direction: 'inbound',
  sent_at: '2026-07-26T10:00:30.000Z',
  email_from: 'candidate@example.com',
  email_to: ['recruitment@example.com'],
  ...overrides,
});

describe('candidate email history', () => {
  it('bouwt een begrensde Outlook participants-zoekopdracht', () => {
    expect(normalizeCandidateEmail(' Candidate@Example.com ')).toBe('candidate@example.com');
    expect(buildOutlookParticipantSearch(' Candidate@Example.com ')).toBe('participants:candidate@example.com');
    expect(buildOutlookParticipantSearch('geen geldig adres')).toBeNull();
  });

  it('combineert Outlook en dossiercommunicatie op nieuwste eerst', () => {
    const result = mergeCandidateHistory(
      [communication({ id: 'note', channel: 'notitie', sent_at: '2026-07-26T09:00:00.000Z' })],
      [outlookMessage()],
      'candidate@example.com',
    );

    expect(result.map((item) => item.source)).toEqual(['outlook', 'communication']);
    expect(result[0]).toMatchObject({
      direction: 'inbound',
      mailbox_label: 'Recruitment',
      from: 'candidate@example.com',
    });
  });

  it('ontdubbelt een opgeslagen Outlook-bericht op Graph message-id', () => {
    const result = mergeCandidateHistory(
      [communication({ email_message_id: 'graph-1' })],
      [outlookMessage()],
      'candidate@example.com',
    );

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('outlook');
  });

  it('ontdubbelt uitgaande logs zonder Graph-id op onderwerp, richting en tijd', () => {
    const result = mergeCandidateHistory(
      [communication({
        direction: 'outbound',
        sent_at: '2026-07-26T10:01:00.000Z',
        email_from: 'recruitment@example.com',
        email_to: ['candidate@example.com'],
      })],
      [outlookMessage({
        from: { address: 'recruitment@example.com' },
        to: [{ address: 'candidate@example.com' }],
      })],
      'candidate@example.com',
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source: 'outlook', direction: 'outbound' });
  });

  it('behoudt gelijknamige berichten wanneer de tijden niet bij dezelfde verzending horen', () => {
    const result = mergeCandidateHistory(
      [communication({ sent_at: '2026-07-25T10:00:00.000Z' })],
      [outlookMessage()],
      'candidate@example.com',
    );

    expect(result).toHaveLength(2);
  });
});
