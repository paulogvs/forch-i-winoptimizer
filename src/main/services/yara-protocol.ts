/**
 * YARA worker protocol (Fase 4.4).
 *
 * Message shapes shared by `yara-engine.ts` (main thread side) and
 * `yara-worker.ts` (worker_thread side). This module has NO dependencies —
 * in particular it never touches `@litko/yara-x`, so importing it from the
 * main thread cannot pull the native module into the wrong thread.
 */

export interface YaraProtocolRuleMatch {
  rule: string;
  namespace: string;
  tags: string[];
  description: string | null;
}

export interface YaraRuleSource {
  /** Raw YARA source text (one .yar file). */
  source: string;
  /** Namespace for the source (the .yar base name). */
  namespace: string;
}

export type WorkerRequest =
  | { id: number; kind: 'init'; rules: YaraRuleSource[] }
  | { id: number; kind: 'scan-buffer'; dataBase64: string; filename: string }
  | { id: number; kind: 'scan-file'; path: string };

export type WorkerResponse =
  | { id: number; kind: 'init'; ok: true; ruleCount: number; engineVersion: string }
  | { id: number; kind: 'init'; ok: false; error: string }
  | { id: number; kind: 'scan'; ok: true; matches: YaraProtocolRuleMatch[] }
  | { id: number; kind: 'scan'; ok: false; error: string };
