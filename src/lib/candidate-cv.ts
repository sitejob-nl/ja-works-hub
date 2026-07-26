import type { Database } from '@/integrations/supabase/types';

type DocumentInsert = Database['public']['Tables']['documents']['Insert'];

type ImportedCvDocumentInput = {
  organizationId: string;
  candidateId: string;
  fileName: string;
  filePath: string;
};

export const buildImportedCvDocumentRow = ({
  organizationId,
  candidateId,
  fileName,
  filePath,
}: ImportedCvDocumentInput): DocumentInsert => ({
  organization_id: organizationId,
  candidate_id: candidateId,
  type: 'cv',
  name: fileName,
  file_path: filePath,
  source: 'upload',
});
