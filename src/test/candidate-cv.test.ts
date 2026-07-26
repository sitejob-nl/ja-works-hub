import { describe, expect, it } from 'vitest';
import { buildImportedCvDocumentRow } from '@/lib/candidate-cv';

describe('candidate CV import', () => {
  it('registreert een geïmporteerd CV als upload bij de kandidaatdocumenten', () => {
    expect(buildImportedCvDocumentRow({
      organizationId: 'org-1',
      candidateId: 'candidate-1',
      fileName: 'CV Jan Jansen.pdf',
      filePath: 'org-1/candidate-1/cv_123.pdf',
    })).toEqual({
      organization_id: 'org-1',
      candidate_id: 'candidate-1',
      type: 'cv',
      name: 'CV Jan Jansen.pdf',
      file_path: 'org-1/candidate-1/cv_123.pdf',
      source: 'upload',
    });
  });
});
