import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  to?: string;
}

interface PageHeaderProps {
  /** Broodkruimelpad. Het laatste item wordt altijd als huidige pagina (niet-klikbaar) getoond. */
  breadcrumbs?: Crumb[];
  title: ReactNode;
  /** Subtitel / korte omschrijving onder de titel. */
  description?: ReactNode;
  /** Rechts uitgelijnde actieknoppen. */
  actions?: ReactNode;
  /** Pagina-specifieke extra's onder de titelrij (badges, voortgang, sub-links). */
  children?: ReactNode;
  className?: string;
}

/**
 * Gedeelde paginakop: consistente broodkruimels + titel + acties over alle pagina's.
 * Lijstpagina's gebruiken hem zonder `breadcrumbs` (alleen titel + acties); detailpagina's
 * met `breadcrumbs` voor het "waar ben ik"-pad. Vervangt de ad-hoc ChevronRight-koppen.
 */
export default function PageHeader({ breadcrumbs, title, description, actions, children, className }: PageHeaderProps) {
  const crumbs = breadcrumbs ?? [];
  return (
    <div className={cn('space-y-3 min-w-0', className)}>
      {crumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList>
            {crumbs.map((crumb, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <Fragment key={`${crumb.label}-${i}`}>
                  <BreadcrumbItem>
                    {crumb.to && !isLast ? (
                      <BreadcrumbLink asChild>
                        <Link to={crumb.to}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage className="truncate max-w-[60vw] sm:max-w-none">{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator />}
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold truncate">{title}</h1>
          {description != null && <div className="text-muted-foreground text-sm mt-1">{description}</div>}
          {children}
        </div>
        {actions != null && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
