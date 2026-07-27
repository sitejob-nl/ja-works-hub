import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { usePublicUrl } from '@/hooks/usePublicUrl';
import { Button } from '@/components/ui/button';

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'vacature';

const VacancySignupLinkButton = ({ vacancy }: { vacancy: any }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const companyName = (vacancy.companies as any)?.name ?? null;

  // Deze link gaat naar sollicitanten, dus hij moet het eigen domein van de organisatie
  // gebruiken — niet het domein waarop de intercedent nu toevallig werkt.
  const { buildUrl } = usePublicUrl();

  const copyToClipboard = async (slug: string) => {
    const url = buildUrl(`/solliciteren/${slug}`);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Sollicitatielink gekopieerd');
    } catch {
      toast.info(url);
    }
  };

  const { data: existingLink, isLoading } = useQuery({
    queryKey: ['vacancy-signup-link', orgId, vacancy.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('candidate_signup_links')
        .select('id, slug, title, current_signups')
        .eq('organization_id', orgId)
        .eq('vacancy_id', vacancy.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!orgId && !!vacancy.id,
  });

  const createLinkMutation = useMutation({
    mutationFn: async () => {
      if (existingLink?.slug) return existingLink;
      const slug = `vacature-${slugify(vacancy.title)}-${crypto.randomUUID().slice(0, 8)}`;
      const { data, error } = await (supabase as any)
        .from('candidate_signup_links')
        .insert({
          organization_id: orgId,
          vacancy_id: vacancy.id,
          slug,
          title: `Solliciteren: ${vacancy.title}`,
          description: `Laat je gegevens en CV achter voor ${vacancy.title}${companyName ? ` bij ${companyName}` : ''}.`,
          source_tag: 'website_sollicitatie',
          is_active: true,
          show_cv_upload: true,
          show_languages: true,
          show_nationality: true,
          show_drivers_license: true,
          show_availability: true,
        })
        .select('id, slug, title, current_signups')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async (link) => {
      qc.invalidateQueries({ queryKey: ['vacancy-signup-link', orgId, vacancy.id] });
      await copyToClipboard(link.slug);
    },
    onError: (error: any) => toast.error(error.message ?? 'Sollicitatielink kon niet worden gemaakt'),
  });

  const handleClick = async () => {
    if (existingLink?.slug) {
      await copyToClipboard(existingLink.slug);
      return;
    }
    createLinkMutation.mutate();
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1"
      onClick={handleClick}
      disabled={isLoading || createLinkMutation.isPending}
    >
      {createLinkMutation.isPending || isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : existingLink?.slug ? (
        <Copy className="h-4 w-4" />
      ) : (
        <Link2 className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">{existingLink?.slug ? 'Sollicitatielink' : 'Maak sollicitatielink'}</span>
      <span className="sm:hidden">Link</span>
    </Button>
  );
};

export default VacancySignupLinkButton;
