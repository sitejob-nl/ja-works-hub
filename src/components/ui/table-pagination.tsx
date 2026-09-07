import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getPaginationRange } from '@/lib/pagination';
import { PAGE_SIZE_OPTIONS, type PageSize } from '@/lib/table-sort';

type TablePaginationProps = {
  /** 0-gebaseerd. */
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  pageSize: PageSize;
  onPageSizeChange: (size: PageSize) => void;
};

/**
 * Voettekst van een lijst: hoeveel rijen per pagina, en de paginanavigatie zelf.
 *
 * De paginagroottekeuze staat er ook bij één pagina, zodat een gebruiker die op 100
 * rijen staat die keuze ziet en kan terugdraaien in plaats van hem te moeten raden.
 */
const TablePagination = ({
  page,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
}: TablePaginationProps) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Rijen per pagina</span>
      <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value) as PageSize)}>
        <SelectTrigger className="h-9 w-[72px]" aria-label="Rijen per pagina">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZE_OPTIONS.map((option) => (
            <SelectItem key={option} value={String(option)}>{option}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    {totalPages > 1 && (
      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => onPageChange(Math.max(0, page - 1))}
              className={page === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
            />
          </PaginationItem>
          {getPaginationRange(page, totalPages).map((item, i) => (
            <PaginationItem key={`${item}-${i}`}>
              {typeof item === 'number' ? (
                <PaginationLink isActive={item === page} onClick={() => onPageChange(item)} className="cursor-pointer">
                  {item + 1}
                </PaginationLink>
              ) : (
                <PaginationEllipsis />
              )}
            </PaginationItem>
          ))}
          <PaginationItem>
            <PaginationNext
              onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
              className={page >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    )}
  </div>
);

export default TablePagination;
