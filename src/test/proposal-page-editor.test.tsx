import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProposalPageEditor from '@/components/matches/ProposalPageEditor';
import { DEFAULT_PROPOSAL_PAGE_CONFIG } from '@/lib/proposal-page';

describe('ProposalPageEditor', () => {
  it('toont sectiekeuzes en een echte klantpagina-preview', () => {
    const onChange = vi.fn();
    const onRefresh = vi.fn();

    render(
      <ProposalPageEditor
        config={DEFAULT_PROPOSAL_PAGE_CONFIG}
        responseUrl="https://voorbeeld.test/match-response/token"
        previewRevision={3}
        loading={false}
        dirty
        onChange={onChange}
        onRefresh={onRefresh}
        onCopyLink={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Aandachtspunten tonen')).not.toBeChecked();
    expect(screen.getByTitle('klantpagina-preview')).toHaveAttribute(
      'src',
      'https://voorbeeld.test/match-response/token?preview=3',
    );
    expect(screen.getByText('Niet bijgewerkt')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Paginatitel'), { target: { value: 'Voorstel ploegendienst' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: 'Voorstel ploegendienst' }));

    fireEvent.click(screen.getByRole('button', { name: 'Voorbeeld bijwerken' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
