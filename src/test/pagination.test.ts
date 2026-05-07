import { describe, expect, it } from 'vitest';
import { getPaginationRange } from '@/lib/pagination';

describe('getPaginationRange', () => {
  it('returns full range when below threshold', () => {
    expect(getPaginationRange(0, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('shows left block + ellipsis + last when current is near start', () => {
    expect(getPaginationRange(0, 198)).toEqual([0, 1, 2, 3, 4, 'ellipsis-right', 197]);
    expect(getPaginationRange(2, 198)).toEqual([0, 1, 2, 3, 4, 'ellipsis-right', 197]);
  });

  it('shows first + ellipsis + middle + ellipsis + last when current is in the middle', () => {
    expect(getPaginationRange(50, 198)).toEqual([
      0,
      'ellipsis-left',
      49,
      50,
      51,
      'ellipsis-right',
      197,
    ]);
  });

  it('shows first + ellipsis + right block when current is near end', () => {
    expect(getPaginationRange(197, 198)).toEqual([
      0,
      'ellipsis-left',
      193,
      194,
      195,
      196,
      197,
    ]);
  });

  it('handles 1 page', () => {
    expect(getPaginationRange(0, 1)).toEqual([0]);
  });
});
