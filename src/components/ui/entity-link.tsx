import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { entityPath, type EntityType, type EntityPathOptions } from '@/lib/entity-routes';

interface EntityLinkProps extends EntityPathOptions {
  type: EntityType;
  id?: string | null;
  children: ReactNode;
  className?: string;
  /**
   * Stopt de click van bubbelen naar een omliggende klikbare rij (default true).
   * Zo blijft de link veilig binnen een <TableRow onClick={...}>.
   */
  stopPropagation?: boolean;
  /** Wordt getoond als er geen geldig id is; valt anders terug op children. */
  fallback?: ReactNode;
  title?: string;
}

/**
 * Maakt een entiteitsnaam klikbaar naar zijn detailpagina. Valt terug op platte
 * tekst wanneer het id ontbreekt, zodat het overal veilig te gebruiken is — ook
 * binnen klikbare tabelrijen (stopPropagation staat default aan).
 */
export function EntityLink({
  type,
  id,
  children,
  className,
  stopPropagation = true,
  fallback,
  title,
  tab,
  params,
}: EntityLinkProps) {
  const to = entityPath(type, id, { tab, params });
  if (!to) return <>{fallback ?? children}</>;

  return (
    <Link
      to={to}
      title={title}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
      }}
      className={cn('text-primary hover:underline underline-offset-2', className)}
    >
      {children}
    </Link>
  );
}

export default EntityLink;
