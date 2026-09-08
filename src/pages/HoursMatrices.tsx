import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useRolePermission } from '@/hooks/usePermissions';
import { useCreateHoursMatrix, useHoursMatrix, useHoursMatrixBinding, useHoursMatrixCompanies, useHoursMatrices } from '@/hooks/useHoursMatrices';
import { hoursMatrixError, type MatrixBinding, type MatrixDetail } from '@/lib/hours-matrices';
import { MatrixVersionEditor } from '@/components/hours-matrices/MatrixVersionEditor';
import { matrixSelectClass } from '@/components/hours-matrices/MatrixConfigFields';
import PageHeader from '@/components/layout/PageHeader';
import ErrorState from '@/components/shared/ErrorState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function CreateMatrix({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const [scope, setScope] = useState<'client' | 'cao'>('client');
  const [companyId, setCompanyId] = useState('');
  const [name, setName] = useState('');
  const companies = useHoursMatrixCompanies(orgId);
  const create = useCreateHoursMatrix(orgId);
  return <Card><CardHeader><CardTitle className="text-base">Nieuwe urenmatrix</CardTitle></CardHeader><CardContent>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (name.trim() && (scope === 'cao' || companyId)) create.mutate({ scope, companyId: scope === 'client' ? companyId : null, name }, { onSuccess: matrix => navigate(`/uren/matrices/${matrix.id}`) }); }}>
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor="matrix-scope">Afspraakbasis</Label><select id="matrix-scope" className={matrixSelectClass} value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="client">Opdrachtgeverafspraken</option><option value="cao">CAO-basis</option></select></div><div className="space-y-1"><Label htmlFor="matrix-name">Naam van de matrix</Label><Input id="matrix-name" value={name} maxLength={200} required onChange={event => setName(event.target.value)} /></div></div>
      {scope === 'client' && <div className="space-y-1"><Label htmlFor="matrix-company">Opdrachtgever</Label><select id="matrix-company" className={matrixSelectClass} value={companyId} disabled={companies.isPending} onChange={event => setCompanyId(event.target.value)}><option value="">Kies een opdrachtgever</option>{companies.data?.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>}
      {companies.error && scope === 'client' && <ErrorState error={companies.error} onRetry={() => void companies.refetch()} />}
      <p className="text-sm text-muted-foreground">Er worden geen standaardfactoren of CAO-regels ingevuld. Leg uitsluitend bevestigde afspraken vast. Een CAO-basis wordt pas gebruikt na een expliciete koppeling aan een opdrachtgever.</p>
      <Button type="submit" disabled={create.isPending || !name.trim() || (scope === 'client' && !companyId)}>Matrix aanmaken</Button>
      {create.error && <p role="alert" className="text-sm text-destructive">{hoursMatrixError(create.error)}</p>}
    </form>
  </CardContent></Card>;
}

function BindingForm({ value, matrices, canManage, onSave }: { value: MatrixBinding; matrices: Pick<MatrixDetail, 'id' | 'name'>[]; canManage: boolean; onSave: (caoMatrixId: string | null, version: number) => Promise<void> }) {
  const [caoId, setCaoId] = useState(value.cao_matrix_id ?? '');
  const [initialVersion] = useState(value.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const stale = initialVersion !== value.version;
  const canEdit = canManage && value.can_manage;
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault(); if (stale || !canEdit) return;
    setBusy(true); setError(null); try { await onSave(caoId || null, initialVersion); } catch (failure) { setError(failure); } finally { setBusy(false); }
  }}>
    <div className="space-y-1"><Label htmlFor="company-cao">Toepasselijke CAO-basis</Label><select id="company-cao" className={matrixSelectClass} value={caoId} disabled={!canEdit || busy || stale} onChange={event => setCaoId(event.target.value)}><option value="">Geen CAO-basis gekoppeld</option>{matrices.map(matrix => <option key={matrix.id} value={matrix.id}>{matrix.name}</option>)}</select></div>
    {canEdit && <Button type="submit" variant="outline" disabled={busy || stale}>CAO-koppeling opslaan</Button>}
    {stale && <p role="alert" className="text-sm text-destructive">De CAO-koppeling is ondertussen gewijzigd. Kies de opdrachtgever opnieuw om de actuele keuze te laden.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{hoursMatrixError(error)}</p>}
  </form>;
}

function CompanyCaoBinding({ orgId, matrices, canManage }: { orgId: string; matrices: Pick<MatrixDetail, 'id' | 'name' | 'scope'>[]; canManage: boolean }) {
  const [companyId, setCompanyId] = useState('');
  const [saved, setSaved] = useState(0);
  const companies = useHoursMatrixCompanies(orgId);
  const binding = useHoursMatrixBinding(orgId, companyId);
  return <Card><CardHeader><CardTitle className="text-base">CAO-basis per opdrachtgever</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">Opdrachtgeverafspraken gaan voor. Alleen als er op de werkdatum geen toepasselijke gepubliceerde opdrachtgeverversie is, wordt de expliciet gekoppelde CAO-basis gebruikt.</p>
    <div className="space-y-1"><Label htmlFor="binding-company">Opdrachtgever voor CAO-koppeling</Label><select id="binding-company" className={matrixSelectClass} value={companyId} onChange={event => setCompanyId(event.target.value)} disabled={companies.isPending}><option value="">Kies een opdrachtgever</option>{companies.data?.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
    {companies.error && <ErrorState error={companies.error} onRetry={() => void companies.refetch()} />}
    {binding.error && <ErrorState message={hoursMatrixError(binding.error)} onRetry={() => void binding.refetch()} />}
    {companyId && binding.isPending && <p role="status">CAO-koppeling laden…</p>}
    {binding.data && <BindingForm key={`${companyId}-${saved}`} value={binding.data} matrices={matrices.filter(matrix => matrix.scope === 'cao')} canManage={canManage} onSave={async (caoMatrixId, expectedVersion) => { await binding.mutation.mutateAsync({ caoMatrixId, expectedVersion }); setSaved(value => value + 1); }} />}
  </CardContent></Card>;
}

function MatrixWorkspace({ orgId, matrixId, canManage }: { orgId: string; matrixId: string; canManage: boolean }) {
  const matrix = useHoursMatrix(orgId, matrixId);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const selectResult = (data: MatrixDetail, previousId?: string) => {
    setSelectedVersion(previousId ?? [...data.versions].sort((a, b) => b.version_number - a.version_number)[0]?.id ?? 'new');
    setEditorRevision(value => value + 1);
  };
  if (matrix.error) return <ErrorState message={hoursMatrixError(matrix.error)} onRetry={() => void matrix.refetch()} />;
  if (!matrix.data) return <p role="status">Matrix laden…</p>;
  const data = matrix.data;
  const activeId = selectedVersion ?? data.versions[0]?.id ?? 'new';
  const version = data.versions.find(item => item.id === activeId);
  const canEdit = canManage && data.can_manage;
  return <div className="space-y-5">
    <Card><CardContent className="space-y-4 pt-6">
      <div><h2 className="font-semibold" data-no-translate="true">{data.name}</h2><p className="text-sm text-muted-foreground" data-no-translate="true">{data.scope === 'client' ? data.company_name : 'CAO-basis'}</p></div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="min-w-0 flex-1 space-y-1"><Label htmlFor="matrix-version">Versie bekijken</Label><select id="matrix-version" className={matrixSelectClass} value={activeId} onChange={event => setSelectedVersion(event.target.value)}>{(activeId === 'new' || !data.versions.length) && <option value="new">Nieuwe conceptversie</option>}{data.versions.map(item => <option key={item.id} value={item.id}>Versie {item.version_number} · {item.status === 'published' ? 'gepubliceerd' : 'concept'} · vanaf {item.valid_from}</option>)}</select></div>{canEdit && <Button variant="outline" onClick={() => { setSelectedVersion('new'); setEditorRevision(value => value + 1); }}>Nieuwe versie</Button>}</div>
    </CardContent></Card>
    {!canEdit && !version ? <p className="text-sm text-muted-foreground">Deze matrix heeft nog geen versies.</p> : <Card><CardContent className="pt-6"><MatrixVersionEditor key={`${matrixId}-${activeId}-${editorRevision}`} matrix={data} version={version} canManage={canEdit} onSave={async draft => selectResult(await matrix.mutation.mutateAsync({ type: 'save', draft, version }), version?.id)} onPublish={async current => selectResult(await matrix.mutation.mutateAsync({ type: 'publish', version: current }), current.id)} onReload={() => { void matrix.refetch().then(result => { if (result.data) selectResult(result.data, version?.id); }); }} /></CardContent></Card>}
  </div>;
}

export default function HoursMatrices() {
  const orgId = useOrganizationId();
  const { matrixId } = useParams();
  const canManage = useRolePermission('finance.manage');
  const matrices = useHoursMatrices(orgId);
  return <div className="space-y-6 min-w-0">
    <PageHeader title="Urenmatrices" breadcrumbs={[{ label: 'Uren', to: '/uren' }, { label: 'Urenmatrices', to: matrixId ? '/uren/matrices' : undefined }, ...(matrixId ? [{ label: 'Matrix inrichten' }] : [])]} description="Beheer bevestigde uurcodes, klantafspraken en expliciete CAO-bases met gedateerde versies." actions={<Button asChild variant="outline"><Link to="/uren/weken">Naar urenweken</Link></Button>} />
    {matrixId ? <MatrixWorkspace key={matrixId} orgId={orgId} matrixId={matrixId} canManage={canManage} /> : matrices.error ? <ErrorState message={hoursMatrixError(matrices.error)} onRetry={() => void matrices.refetch()} /> : matrices.isPending ? <p role="status">Matrices laden…</p> : <>
      {canManage && matrices.data?.can_manage && <CreateMatrix orgId={orgId} />}
      <CompanyCaoBinding orgId={orgId} matrices={matrices.data?.matrices ?? []} canManage={canManage && matrices.data?.can_manage} />
      {matrices.data?.matrices.length === 0 ? <p className="text-sm text-muted-foreground">Er zijn nog geen urenmatrices ingericht.</p> : <div className="grid gap-3 md:grid-cols-2">{matrices.data?.matrices.map(matrix => <Link key={matrix.id} to={`/uren/matrices/${matrix.id}`} className="min-w-0 rounded-xl border bg-card p-4 hover:border-primary focus-visible:outline-primary"><p className="font-semibold break-words" data-no-translate="true">{matrix.name}</p><p className="text-sm text-muted-foreground" data-no-translate="true">{matrix.scope === 'client' ? matrix.company_name : 'CAO-basis'}</p><p className="mt-3 text-sm">{matrix.version_count} versies · {matrix.published_version_count} gepubliceerd</p></Link>)}</div>}
    </>}
  </div>;
}
