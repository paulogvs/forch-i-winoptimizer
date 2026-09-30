/**
 * FORCH.iA WinOptimizer — Source Monitor
 *
 * Watches the 4 base repositories (kudu, winrift, winscript, winutil), diffs their
 * catalogs against the local ones and imports approved changes. Usable from the
 * Electron app (IPC) and from the `winoptimizer-updates` skill via plain Node.
 */
export * from './types';
export { checkAllSources, loadSources, loadLastCheck, saveLastCheck } from './check-updates';
export { importUpdates, importAllPending, rejectUpdate, rejectAllPending } from './import-updates';
export { formatReport, formatPendingForDisplay, getPendingUpdates } from './update-report';
export { loadLocalCatalog, saveLocalCatalog, diffCatalogs, mergeCatalogs } from './diff-catalogs';
export { getStorageDir, getCatalogStorageDir, resolveBundledPath } from './paths';
