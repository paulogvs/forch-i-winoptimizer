import type { UpdateReport, PendingUpdate } from './types';
import { loadLastCheck } from './check-updates';

export function formatReport(report: UpdateReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════');
  lines.push('  FORCH.iA WinOptimizer — Reporte de Actualizaciones');
  lines.push('═══════════════════════════════════════════════════');
  lines.push(`  Fecha: ${new Date(report.timestamp).toLocaleString()}`);
  lines.push(`  Fuentes verificadas: ${report.sourcesChecked}`);
  lines.push('');

  if (report.newItems.length > 0) {
    lines.push(`  NUEVOS (${report.newItems.length}):`);
    for (const item of report.newItems) {
      lines.push(`    • [${item.sourceName}] ${item.item.name} (${item.catalog})`);
    }
    lines.push('');
  }

  if (report.modifiedItems.length > 0) {
    lines.push(`  MODIFICADOS (${report.modifiedItems.length}):`);
    for (const item of report.modifiedItems) {
      lines.push(`    • [${item.sourceName}] ${item.item.name} (${item.catalog})`);
    }
    lines.push('');
  }

  if (report.removedItems.length > 0) {
    lines.push(`  ELIMINADOS (${report.removedItems.length}):`);
    for (const item of report.removedItems) {
      lines.push(`    • [${item.sourceName}] ${item.item.name} (${item.catalog})`);
    }
    lines.push('');
  }

  if (report.errors.length > 0) {
    lines.push(`  ERRORES (${report.errors.length}):`);
    for (const err of report.errors) {
      lines.push(`    • ${err}`);
    }
    lines.push('');
  }

  if (
    report.newItems.length === 0 &&
    report.modifiedItems.length === 0 &&
    report.removedItems.length === 0
  ) {
    lines.push('  Todo está al día. No se encontraron cambios.');
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════');
  return lines.join('\n');
}

export function getPendingUpdates(): PendingUpdate[] {
  const lastCheck = loadLastCheck();
  return lastCheck.pendingUpdates.filter((u) => u.status === 'pending');
}

export function formatPendingForDisplay(): string {
  const pending = getPendingUpdates();
  if (pending.length === 0) return 'No hay actualizaciones pendientes.';

  const lines: string[] = [];
  lines.push(`${pending.length} actualización(es) pendiente(s):`);
  lines.push('');

  const byCatalog = new Map<string, PendingUpdate[]>();
  for (const u of pending) {
    if (!byCatalog.has(u.catalog)) byCatalog.set(u.catalog, []);
    byCatalog.get(u.catalog)!.push(u);
  }

  for (const [catalog, items] of byCatalog) {
    lines.push(`  ${catalog.toUpperCase()} (${items.length}):`);
    for (const item of items) {
      const icon = item.type === 'new' ? '[+]' : item.type === 'modified' ? '[~]' : '[-]';
      lines.push(`    ${icon} ${item.item.name} — ${item.sourceName}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
