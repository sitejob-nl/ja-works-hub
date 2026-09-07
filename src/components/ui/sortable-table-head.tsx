import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { SortState } from '@/lib/table-sort';

type SortableTableHeadProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  /** `key` van de kolom, zoals in de kolomdefinitie en de URL. */
  column: string;
  sort: SortState;
  onSort: (column: string) => void;
  /** Zet op `false` voor kolommen waar sorteren niet zinnig is (afgeleide of gejoinde waarden). */
  sortable?: boolean;
  align?: 'left' | 'right';
};

/**
 * Kolomkop die op klik sorteert. Klikken op de actieve kolom draait de richting om;
 * een andere kolom start in zijn eigen voorkeursrichting.
 *
 * Toegankelijkheid: de kop draagt `aria-sort`, de klikbare kop is een echte `<button>`
 * (dus bereikbaar met Tab en te bedienen met Enter/Spatie) en de pijl is puur decoratief.
 */
const SortableTableHead = React.forwardRef<HTMLTableCellElement, SortableTableHeadProps>(
  ({ column, sort, onSort, sortable = true, align = 'left', className, children, ...props }, ref) => {
    const isActive = sortable && sort.column === column;

    if (!sortable) {
      return (
        <TableHead ref={ref} className={cn(align === 'right' && 'text-right', className)} {...props}>
          {children}
        </TableHead>
      );
    }

    return (
      <TableHead
        ref={ref}
        aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn(align === 'right' && 'text-right', className)}
        {...props}
      >
        <button
          type="button"
          onClick={() => onSort(column)}
          className={cn(
            'group -mx-2 inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 font-medium transition-colors',
            'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isActive ? 'text-foreground' : 'text-muted-foreground',
            align === 'right' && 'flex-row-reverse',
          )}
        >
          <span>{children}</span>
          {isActive ? (
            sort.direction === 'asc'
              ? <ArrowUp aria-hidden className="h-3.5 w-3.5 shrink-0" />
              : <ArrowDown aria-hidden className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronsUpDown
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-50 group-focus-visible:opacity-50"
            />
          )}
        </button>
      </TableHead>
    );
  },
);
SortableTableHead.displayName = 'SortableTableHead';

export default SortableTableHead;
