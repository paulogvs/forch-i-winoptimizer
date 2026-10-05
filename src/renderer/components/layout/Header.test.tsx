import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from './Header';

function renderHeader(onNavigate = vi.fn()) {
  render(
    <Header
      theme="dark"
      onThemeToggle={vi.fn()}
      onSearch={vi.fn()}
      searchQuery=""
      onNavigate={onNavigate}
    />
  );
  return onNavigate;
}

describe('Header (Fase 0)', () => {
  it('0.1: clicking the settings gear navigates to Settings', () => {
    const onNavigate = renderHeader();
    fireEvent.click(screen.getByTestId('open-settings'));
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  it('0.6: Free RAM button discloses its real scope (own process only)', () => {
    renderHeader();
    const btn = screen.getByTestId('free-ram');
    const label = `${btn.getAttribute('title') ?? ''} ${btn.getAttribute('aria-label') ?? ''}`;
    expect(label.toLowerCase()).toMatch(/own|propia|app/);
  });
});
