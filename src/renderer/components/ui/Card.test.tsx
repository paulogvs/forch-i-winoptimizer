import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('renders title', () => {
    render(<Card title="My Title">Content</Card>);
    expect(screen.getByText('My Title')).toBeInTheDocument();
  });

  it('renders header', () => {
    render(<Card header={<span>Header</span>}>Content</Card>);
    expect(screen.getByText('Header')).toBeInTheDocument();
  });

  it('renders footer', () => {
    render(<Card footer={<span>Footer</span>}>Content</Card>);
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('applies hoverable class', () => {
    render(<Card hoverable>Content</Card>);
    expect(screen.getByText('Content').parentElement).toHaveClass('card-hover');
  });
});
