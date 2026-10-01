// Scan progress contract (P0.3).
// The final result contract is unchanged: progress is *additional* telemetry
// streamed while a scan runs so the UI can show stages + percentage.

export type ScanStage = 'discover' | 'query' | 'parse' | 'normalize' | 'done' | 'error';

// Known modules are listed for autocomplete, but the union stays open so new
// modules can be added without touching every switch.
export type ScanModule =
  | 'junk'
  | 'drivers'
  | 'system'
  | 'apps'
  | 'network'
  | 'audit'
  | 'benchmark'
  | 'tweaks'
  | string;

export interface ScanProgressEvent {
  module: ScanModule;
  stage: ScanStage;
  percent: number; // clamped to 0..100
  message?: string;
  etaMs?: number;
}
