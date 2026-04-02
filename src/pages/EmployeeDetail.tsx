import { useParams, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const EmployeeDetail = () => {
  const { id } = useParams<{ id: string }>();

  // id is the employee UUID — look up the candidate_id
  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee-redirect', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('employees')
        .select('candidate_id')
        .eq('id', id!)
        .single();
      return data;
    },
    enabled: !!id,
  });

  if (isLoading) return <div className="p-8 text-center">Laden...</div>;
  if (employee?.candidate_id) return <Navigate to={`/kandidaten/${employee.candidate_id}`} replace />;
  return <Navigate to="/kandidaten" replace />;
};

export default EmployeeDetail;
