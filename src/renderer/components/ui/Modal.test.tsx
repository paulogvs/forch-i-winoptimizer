import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

describe('Modal', () => {
  it('renders when open is true', () => {
    render(
      <Modal open onClose={() => {}} title="Test Modal">
        Content
      </Modal>
    );
    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hidden">
        Content
      </Modal>
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <Modal open onClose={handleClose} title="Test">
        Content
      </Modal>
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay is clicked', () => {
    const handleClose = vi.fn();
    render(
      <Modal open onClose={handleClose} title="Test">
        Content
      </Modal>
    );
    fireEvent.click(screen.getByRole('presentation'));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', () => {
    const handleClose = vi.fn();
    render(
      <Modal open onClose={handleClose} title="Test">
        Content
      </Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('renders footer', () => {
    render(
      <Modal open onClose={() => {}} title="Test" footer={<button>Confirm</button>}>
        Content
      </Modal>
    );
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('traps Tab inside the dialog (wraps last to first)', () => {
    render(
      <Modal open onClose={() => {}} title="Test" footer={<button>Confirm</button>}>
        Content
      </Modal>
    );
    const confirm = screen.getByText('Confirm');
    const close = screen.getByLabelText('Close');
    confirm.focus();
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
  });

  it('traps Shift+Tab inside the dialog (wraps first to last)', () => {
    render(
      <Modal open onClose={() => {}} title="Test" footer={<button>Confirm</button>}>
        Content
      </Modal>
    );
    const confirm = screen.getByText('Confirm');
    const close = screen.getByLabelText('Close');
    close.focus();
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('restores focus to the trigger when closed', () => {
    const Harness = () => {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open it</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Test">
            Content
          </Modal>
        </>
      );
    };
    render(<Harness />);
    const trigger = screen.getByText('Open it');
    // Browsers focus the clicked trigger; jsdom needs the explicit step.
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByText('Test')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });

  it('gives each dialog a unique accessible title id', () => {
    render(
      <>
        <Modal open onClose={() => {}} title="First">
          A
        </Modal>
        <Modal open onClose={() => {}} title="Second">
          B
        </Modal>
      </>
    );
    const dialogs = screen.getAllByRole('dialog');
    const ids = dialogs.map((d) => d.getAttribute('aria-labelledby'));
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id).not.toBe('modal-title');
      expect(document.getElementById(id ?? '')).not.toBeNull();
    }
  });
});
