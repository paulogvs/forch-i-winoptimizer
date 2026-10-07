import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from './Header';

function renderHeader(onNavigate = vi.fn(), onSearchSubmit = vi.fn()) {
  const onSearch = vi.fn();
  render(
    <Header
      theme="dark"
      onThemeToggle={vi.fn()}
      onSearch={onSearch}
      onSearchSubmit={onSearchSubmit}
      searchQuery=""
      onNavigate={onNavigate}
    />
  );
  return { onNavigate, onSearch, onSearchSubmit };
}

describe('Header (Fase 0)', () => {
  it('0.1: clicking the settings gear navigates to Settings', () => {
    const { onNavigate } = renderHeader();
    fireEvent.click(screen.getByTestId('open-settings'));
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  it('0.6: Free RAM button discloses its real scope (own process only)', () => {
    renderHeader();
    const btn = screen.getByTestId('free-ram');
    const label = `${btn.getAttribute('title') ?? ''} ${btn.getAttribute('aria-label') ?? ''}`;
    expect(label.toLowerCase()).toMatch(/own|propia|app/);
  });

  it('B: Enter in search submits, Escape clears', () => {
    const { onSearch, onSearchSubmit } = renderHeader();
    const input = screen.getByLabelText('Search pages');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSearchSubmit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSearch).toHaveBeenCalledWith('');
  });
});
