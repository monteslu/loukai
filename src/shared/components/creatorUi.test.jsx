import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StemProgressBars, IndeterminateProgress, ENCODED_STEMS } from './creatorUi.jsx';

describe('StemProgressBars', () => {
  it('shows the four separated stems by default', () => {
    render(<StemProgressBars progress={{ drums: 0.5 }} label="Separating" />);
    expect(screen.getByText('Separating')).toBeInTheDocument();
    for (const stem of ['drums', 'bass', 'other', 'vocals']) {
      expect(screen.getByText(new RegExp(stem))).toBeInTheDocument();
    }
    expect(screen.queryByText(/mixdown/)).toBeNull();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('adds the mixdown row for encoding, keyed by master', () => {
    render(<StemProgressBars progress={{ master: 0.25, vocals: 1 }} stems={ENCODED_STEMS} />);
    expect(screen.getByText(/mixdown/)).toBeInTheDocument();
    expect(screen.queryByText(/master/)).toBeNull();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getAllByText('0%')).toHaveLength(3);
  });
});

describe('IndeterminateProgress', () => {
  it('renders a busy progressbar with its label', () => {
    render(<IndeterminateProgress label="Correcting lyrics with LLM…" />);
    const bar = screen.getByRole('progressbar', { name: 'Correcting lyrics with LLM…' });
    expect(bar).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Correcting lyrics with LLM…')).toBeInTheDocument();
  });
});
