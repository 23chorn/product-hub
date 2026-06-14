import fs from 'fs';
import path from 'path';

// ── File logging ───────────────────────────────────────────────────────────────
// Logs land in app/backend/logs/app-YYYY-MM-DD.log, one file per day.
// The directory is created lazily on first write so startup is not blocked.
const LOG_DIR = path.resolve(__dirname, '../../logs');
let logDirEnsured = false;

function ensureLogDir(): void {
  if (logDirEnsured) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logDirEnsured = true;
  } catch { /* non-fatal */ }
}

function logFilePath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `app-${date}.log`);
}

function writeToFile(line: string): void {
  try {
    ensureLogDir();
    fs.appendFileSync(logFilePath(), line + '\n', 'utf-8');
  } catch { /* never crash the app over a logging failure */ }
}

// ── Logger class ───────────────────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

class Logger {
  private prefix: string;

  constructor(prefix: string = 'APP') {
    this.prefix = prefix;
  }

  private format(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] [${this.prefix}] ${message}`;
  }

  info(message: string, ...args: any[]): void {
    const line = this.format('info', message);
    console.log(line, ...args);
    writeToFile(args.length ? `${line} ${args.map(a => JSON.stringify(a)).join(' ')}` : line);
  }

  warn(message: string, ...args: any[]): void {
    const line = this.format('warn', message);
    console.warn(line, ...args);
    writeToFile(args.length ? `${line} ${args.map(a => JSON.stringify(a)).join(' ')}` : line);
  }

  error(message: string, error?: any): void {
    const line = this.format('error', message);
    console.error(line);
    if (error) {
      if (error.stack) console.error(error.stack);
      else console.error(error);
    }
    const detail = error
      ? (error.stack ?? String(error))
      : undefined;
    writeToFile(detail ? `${line}\n${detail}` : line);
  }

  debug(message: string, ...args: any[]): void {
    if (process.env.NODE_ENV !== 'development' && !process.env.DEBUG) return;
    const line = this.format('debug', message);
    console.debug(line, ...args);
    writeToFile(args.length ? `${line} ${args.map(a => JSON.stringify(a)).join(' ')}` : line);
  }
}

export default Logger;
