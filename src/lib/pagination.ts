export type PaginationItem = number | 'ellipsis-left' | 'ellipsis-right';

export function getPaginationRange(
  currentPage: number,
  totalPages: number,
  siblingCount = 1,
): PaginationItem[] {
  const totalPageNumbers = siblingCount * 2 + 5;

  if (totalPages <= totalPageNumbers) {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const leftSibling = Math.max(currentPage - siblingCount, 0);
  const rightSibling = Math.min(currentPage + siblingCount, totalPages - 1);

  const showLeftEllipsis = leftSibling > 1;
  const showRightEllipsis = rightSibling < totalPages - 2;

  const firstIndex = 0;
  const lastIndex = totalPages - 1;

  if (!showLeftEllipsis && showRightEllipsis) {
    const leftCount = 3 + 2 * siblingCount;
    const leftRange = Array.from({ length: leftCount }, (_, i) => i);
    return [...leftRange, 'ellipsis-right', lastIndex];
  }

  if (showLeftEllipsis && !showRightEllipsis) {
    const rightCount = 3 + 2 * siblingCount;
    const rightRange = Array.from(
      { length: rightCount },
      (_, i) => totalPages - rightCount + i,
    );
    return [firstIndex, 'ellipsis-left', ...rightRange];
  }

  const middleRange = Array.from(
    { length: rightSibling - leftSibling + 1 },
    (_, i) => leftSibling + i,
  );
  return [firstIndex, 'ellipsis-left', ...middleRange, 'ellipsis-right', lastIndex];
}
