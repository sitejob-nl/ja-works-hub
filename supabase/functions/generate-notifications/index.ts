import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No auth header');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get user's org
    const { data: { user } } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    ).auth.getUser();

    if (!user) throw new Error('Unauthorized');

    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (!profile) throw new Error('No profile');
    const orgId = profile.organization_id;

    const today = new Date().toISOString().split('T')[0];
    const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    const sevenDays = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    let created = 0;

    // Helper: check if notification already exists recently (last 24h)
    const exists = async (type: string, refId: string) => {
      const since = new Date(Date.now() - 86400000).toISOString();
      const { count } = await supabase
        .from('employee_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('type', type)
        .eq('reference_id', refId)
        .gte('created_at', since);
      return (count ?? 0) > 0;
    };

    // 1. Expiring contracts (within 30 days) — via candidate_employment
    const { data: expiringContracts } = await supabase
      .from('candidate_employment')
      .select('id, candidate_id, end_date, candidates!candidate_employment_candidate_id_fkey(first_name, last_name)')
      .eq('organization_id', orgId)
      .eq('is_current', true)
      .not('end_date', 'is', null)
      .lte('end_date', thirtyDays)
      .gte('end_date', today);

    for (const ce of expiringContracts ?? []) {
      if (await exists('contract_aflopend', ce.candidate_id)) continue;
      const cand = (ce as any).candidates;
      const days = Math.ceil((new Date(ce.end_date!).getTime() - Date.now()) / 86400000);
      await supabase.from('employee_notifications').insert({
        organization_id: orgId,
        candidate_id: ce.candidate_id,
        type: 'contract_aflopend',
        title: `Contract ${cand?.first_name} ${cand?.last_name} loopt af`,
        message: `Het contract loopt af over ${days} dagen (${ce.end_date}).`,
        severity: days <= 7 ? 'urgent' : days <= 14 ? 'warning' : 'info',
        reference_table: 'candidates',
        reference_id: ce.candidate_id,
        due_date: ce.end_date,
      });
      created++;
    }

    // 2. Expired/expiring documents
    const { data: expiringDocs } = await supabase
      .from('documents')
      .select('id, name, type, expiry_date, candidate_id, candidates!documents_candidate_id_fkey(first_name, last_name)')
      .eq('organization_id', orgId)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', thirtyDays)
      .in('status', ['geldig', 'verloopt_binnenkort']);

    for (const doc of expiringDocs ?? []) {
      if (await exists('document_verlopen', doc.id)) continue;
      const cand = (doc as any).candidates;
      const isExpired = new Date(doc.expiry_date!) < new Date();
      await supabase.from('employee_notifications').insert({
        organization_id: orgId,
        candidate_id: doc.candidate_id,
        type: isExpired ? 'document_verlopen' : 'document_verlopen',
        title: `${doc.name} van ${cand?.first_name} ${cand?.last_name} ${isExpired ? 'is verlopen' : 'verloopt binnenkort'}`,
        message: `Document verloopt op ${doc.expiry_date}.`,
        severity: isExpired ? 'urgent' : 'warning',
        reference_table: 'documents',
        reference_id: doc.id,
        due_date: doc.expiry_date,
      });
      created++;
    }

    // 3. Missing required documents
    const { data: activeCandidates } = await supabase
      .from('candidates')
      .select('id, first_name, last_name')
      .eq('organization_id', orgId)
      .in('employee_status', ['actief', 'onboarding'])
      .limit(200);

    if (activeCandidates?.length) {
      const candidateIds = activeCandidates.map(c => c.id);
      const { data: docs } = await supabase
        .from('documents')
        .select('candidate_id, type')
        .in('candidate_id', candidateIds)
        .in('type', ['id_bewijs', 'bankbewijs']);

      const docMap = new Map<string, Set<string>>();
      (docs ?? []).forEach(d => {
        if (!docMap.has(d.candidate_id)) docMap.set(d.candidate_id, new Set());
        docMap.get(d.candidate_id)!.add(d.type);
      });

      for (const cand of activeCandidates) {
        const existing = docMap.get(cand.id) ?? new Set();
        const missing = ['id_bewijs', 'bankbewijs'].filter(t => !existing.has(t));
        if (missing.length === 0) continue;
        if (await exists('document_ontbrekend', cand.id)) continue;
        await supabase.from('employee_notifications').insert({
          organization_id: orgId,
          candidate_id: cand.id,
          type: 'document_ontbrekend',
          title: `${cand.first_name} ${cand.last_name} mist documenten`,
          message: `Ontbrekend: ${missing.join(', ')}.`,
          severity: 'warning',
          reference_table: 'candidates',
          reference_id: cand.id,
        });
        created++;
      }
    }

    // 4. Pending timesheets
    const { data: pendingTs } = await supabase
      .from('timesheets')
      .select('candidate_id')
      .eq('organization_id', orgId)
      .in('status', ['concept', 'ingediend']);

    const pendingByCand = new Map<string, number>();
    (pendingTs ?? []).forEach(t => {
      if (t.candidate_id) pendingByCand.set(t.candidate_id, (pendingByCand.get(t.candidate_id) ?? 0) + 1);
    });

    for (const [candId, count] of pendingByCand) {
      if (count < 3) continue; // Only notify if 3+ pending
      if (await exists('uren_openstaand', candId)) continue;
      await supabase.from('employee_notifications').insert({
        organization_id: orgId,
        candidate_id: candId,
        type: 'uren_openstaand',
        title: `${count} openstaande urenregistraties`,
        message: `Er zijn ${count} niet-goedgekeurde urenregistraties.`,
        severity: count >= 7 ? 'urgent' : 'warning',
        reference_table: 'timesheets',
        reference_id: candId,
      });
      created++;
    }

    // 5. Birthdays (today + 7 days)
    const { data: candidates } = await supabase
      .from('candidates')
      .select('id, first_name, last_name, date_of_birth')
      .eq('organization_id', orgId)
      .not('date_of_birth', 'is', null);

    const now = new Date();
    for (const c of candidates ?? []) {
      const dob = new Date(c.date_of_birth!);
      const bday = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
      if (bday < now) bday.setFullYear(now.getFullYear() + 1);
      const daysUntil = Math.ceil((bday.getTime() - now.getTime()) / 86400000);
      if (daysUntil > 7) continue;
      if (await exists('verjaardag', c.id)) continue;
      const age = now.getFullYear() - dob.getFullYear();
      await supabase.from('employee_notifications').insert({
        organization_id: orgId,
        candidate_id: c.id,
        type: 'verjaardag',
        title: `${c.first_name} ${c.last_name} wordt ${age} jaar`,
        message: daysUntil === 0 ? 'Vandaag jarig! 🎂' : `Over ${daysUntil} dagen jarig.`,
        severity: 'info',
        reference_table: 'candidates',
        reference_id: c.id,
      });
      created++;
    }

    return new Response(JSON.stringify({ created }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
