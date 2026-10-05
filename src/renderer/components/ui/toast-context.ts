import { createContext, useContext } from 'react';

/**
 * Toast context + hook (Fase 3.4). Kept in a component-free module so the
 * `react-refresh/only-export-components` rule stays satisfied: `Toast.tsx`
 * exports only the provider component.
 */

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  title: string;
  message?: string;
  variant?: ToastVariant;
  action?: ToastAction;
  /** Auto-dismiss delay in ms. `0` keeps it until dismissed manually. */
  durationMs?: number;
}

export interface ToastContextValue {
  notify: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
}

const NOOP: ToastContextValue = {
  notify: () => '',
  dismiss: () => undefined,
};

export const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Access the toast API. Outside a provider it degrades to a no-op instead of
 * throwing, so isolated component renders (unit tests, partial previews) keep
 * working.
 */
export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? NOOP;
}
