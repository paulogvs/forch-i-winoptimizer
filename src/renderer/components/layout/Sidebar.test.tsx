import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';

function renderSidebar(searchQuery = '') {
  const onNavigate = vi.fn();
  render(<Sidebar currentPage="dashboard" onNavigate={onNavigate} searchQuery={searchQuery} />);
  return onNavigate;
}

describe('Sidebar (Fase B: sections + search filter)', () => {
  it('groups navigation into labelled sections', () => {
    renderSidebar();
    for (const section of ['System health', 'System', 'Analysis', 'App']) {
      expect(screen.getByText(section)).toBeInTheDocument();
    }
  });

  it('renders inline SVG icons instead of emoji', () => {
    const { container } = render(
      <Sidebar currentPage="dashboard" onNavigate={vi.fn()} searchQuery="" />
    );
    expect(container.querySelectorAll('svg.ui-icon').length).toBeGreaterThanOrEqual(14);
    expect(container.textContent).not.toMatch(/📊|🧹|🚀|🔧/);
  });

  it('marks the current page with aria-current', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: /Dashboard/ })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('filters items by the header search query', () => {
    renderSidebar('sec');
    expect(screen.getByRole('button', { name: /Security/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Boost$/ })).not.toBeInTheDocument();
  });

  it('shows an honest empty note when nothing matches', () => {
    renderSidebar('zzz-no-match');
    expect(screen.getByText(/No pages match/)).toBeInTheDocument();
  });
});
