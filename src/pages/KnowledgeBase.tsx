import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, BookOpen, Search, Loader2, Trash2, Pencil } from 'lucide-react';

const CATEGORY_OPTIONS = [
  { value: 'algemeen', label: 'Algemeen', color: 'secondary' as const },
  { value: 'uitzendkracht', label: 'Uitzendkracht', color: 'default' as const },
  { value: 'intern', label: 'Intern', color: 'outline' as const },
];

const getCategoryBadge = (cat: string | null) => {
  const opt = CATEGORY_OPTIONS.find((o) => o.value === cat) || CATEGORY_OPTIONS[0];
  return <Badge variant={opt.color}>{opt.label}</Badge>;
};

const KnowledgeBase = () => {
  const organizationId = useOrganizationId();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editArticle, setEditArticle] = useState<any>(null);
  const [viewArticle, setViewArticle] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState('algemeen');
  const [formContent, setFormContent] = useState('');
  const [formPublished, setFormPublished] = useState(true);

  const { data: articles, isLoading } = useQuery({
    queryKey: ['knowledge-base', organizationId, search, categoryFilter, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from('knowledge_base')
        .select(`
          *,
          profiles!knowledge_base_created_by_fkey(full_name)
        `, { count: 'exact' })
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (search.trim()) {
        query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`);
      }
      if (categoryFilter !== 'all') {
        query = query.eq('category', categoryFilter);
      }
      if (statusFilter === 'published') {
        query = query.eq('is_published', true);
      } else if (statusFilter === 'draft') {
        query = query.eq('is_published', false);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { items: data, count: count || 0 };
    },
  });

  const openCreateSheet = () => {
    setEditArticle(null);
    setFormTitle('');
    setFormCategory('algemeen');
    setFormContent('');
    setFormPublished(true);
    setSheetOpen(true);
  };

  const openEditSheet = (article: any) => {
    setEditArticle(article);
    setFormTitle(article.title);
    setFormCategory(article.category || 'algemeen');
    setFormContent(article.content);
    setFormPublished(article.is_published);
    setSheetOpen(true);
    setViewArticle(null);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editArticle) {
        const { error } = await supabase
          .from('knowledge_base')
          .update({
            title: formTitle,
            category: formCategory,
            content: formContent,
            is_published: formPublished,
          })
          .eq('id', editArticle.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('knowledge_base')
          .insert({
            organization_id: organizationId,
            created_by: user?.id || null,
            title: formTitle,
            category: formCategory,
            content: formContent,
            is_published: formPublished,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editArticle ? 'Artikel bijgewerkt' : 'Artikel aangemaakt');
      queryClient.invalidateQueries({ queryKey: ['knowledge-base'] });
      setSheetOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('knowledge_base').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Artikel verwijderd');
      queryClient.invalidateQueries({ queryKey: ['knowledge-base'] });
      setDeleteConfirm(null);
      setViewArticle(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const items = articles?.items || [];
  const totalCount = articles?.count || 0;
  const isAdmin = profile?.role === 'admin';

  const canEdit = (article: any) => isAdmin || article.created_by === user?.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Kennisbank</h1>
          <p className="text-muted-foreground mt-1">Interne kennisbank en documentatie</p>
        </div>
        <Button onClick={openCreateSheet}>
          <Plus className="h-4 w-4 mr-2" /> Nieuw artikel
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Zoek op titel of inhoud..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle categorieën</SelectItem>
            {CATEGORY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statussen</SelectItem>
            <SelectItem value="published">Gepubliceerd</SelectItem>
            <SelectItem value="draft">Concept</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary">{totalCount} artikelen</Badge>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground/40" />
          <p className="text-muted-foreground">Nog geen artikelen</p>
          <Button variant="outline" onClick={openCreateSheet}>Schrijf je eerste artikel</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((article: any) => (
            <Card
              key={article.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setViewArticle(article)}
            >
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-foreground line-clamp-2">{article.title}</h3>
                  <div className="flex gap-1 shrink-0">
                    {getCategoryBadge(article.category)}
                    {!article.is_published && <Badge variant="outline" className="text-yellow-600 border-yellow-300">Concept</Badge>}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {article.content?.substring(0, 150)}
                  {article.content?.length > 150 ? '...' : ''}
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{article.profiles?.full_name || 'Onbekend'}</span>
                  <span>{formatDate(article.created_at)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* View article dialog */}
      <Dialog open={!!viewArticle} onOpenChange={(open) => { if (!open) setViewArticle(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">{viewArticle?.title}</DialogTitle>
          </DialogHeader>
          {viewArticle && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 items-center text-sm">
                {getCategoryBadge(viewArticle.category)}
                {!viewArticle.is_published && <Badge variant="outline" className="text-yellow-600 border-yellow-300">Concept</Badge>}
                <span className="text-muted-foreground">{viewArticle.profiles?.full_name}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{formatDate(viewArticle.created_at)}</span>
              </div>
              <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap border-t pt-4">
                {viewArticle.content}
              </div>
              {canEdit(viewArticle) && (
                <div className="flex gap-2 pt-2 border-t">
                  <Button variant="outline" size="sm" onClick={() => openEditSheet(viewArticle)}>
                    <Pencil className="h-4 w-4 mr-1" /> Bewerken
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteConfirm(viewArticle.id)}>
                    <Trash2 className="h-4 w-4 mr-1" /> Verwijderen
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Artikel verwijderen?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Dit kan niet ongedaan worden gemaakt.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Annuleren</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)} disabled={deleteMutation.isPending}>
              Verwijderen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create/Edit sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editArticle ? 'Artikel bewerken' : 'Nieuw artikel'}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label>Titel *</Label>
              <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Titel van het artikel..." />
            </div>

            <div className="space-y-2">
              <Label>Categorie</Label>
              <Select value={formCategory} onValueChange={setFormCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Inhoud *</Label>
              <Textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="Schrijf je artikel..."
                className="min-h-[250px]"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={formPublished} onCheckedChange={setFormPublished} />
              <Label>Gepubliceerd</Label>
            </div>

            <Button
              className="w-full"
              onClick={() => saveMutation.mutate()}
              disabled={!formTitle.trim() || !formContent.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editArticle ? 'Bijwerken' : 'Opslaan'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default KnowledgeBase;
