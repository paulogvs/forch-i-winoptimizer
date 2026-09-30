import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

class Logger {
  private logDir: string;
  private logFile: string = '';
  private maxFileSize = 5 * 1024 * 1024; // 5MB

  constructor() {
    this.logDir = path.join(app.getPath('userData'), 'logs');
    this.logFile = path.join(this.logDir, `app-${this.getDateString()}.log`);
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getDateString(): string {
    return new Date().toISOString().split('T')[0]!;
  }

  private formatMessage(entry: LogEntry): string {
    const data = entry.data ? ` | ${JSON.stringify(entry.data)}` : '';
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${data}\n`;
  }

  private write(entry: LogEntry): void {
    try {
      const formatted = this.formatMessage(entry);
      fs.appendFileSync(this.logFile, formatted);

      // Rotate if too large
      const stats = fs.statSync(this.logFile);
      if (stats.size > this.maxFileSize) {
        this.rotateLog();
      }
    } catch {
      // Silent fail for logging
    }
  }

  private rotateLog(): void {
    const backupFile = `${this.logFile}.old`;
    if (fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile);
    }
    fs.renameSync(this.logFile, backupFile);
  }

  debug(message: string, data?: unknown): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'debug',
      message,
      data,
    });
  }

  info(message: string, data?: unknown): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
      data,
    });
  }

  warn(message: string, data?: unknown): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message,
      data,
    });
  }

  error(message: string, data?: unknown): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      data,
    });
  }

  getLogPath(): string {
    return this.logFile;
  }

  getLogDir(): string {
    return this.logDir;
  }
}

export const logger = new Logger();
