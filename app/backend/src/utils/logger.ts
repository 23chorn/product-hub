type LogLevel = 'info' | 'warn' | 'error' | 'debug';

class Logger {
  private prefix: string;

  constructor(prefix: string = 'APP') {
    this.prefix = prefix;
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] [${this.prefix}] ${message}`;
  }

  info(message: string, ...args: any[]): void {
    console.log(this.formatMessage('info', message), ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(this.formatMessage('warn', message), ...args);
  }

  error(message: string, error?: any): void {
    console.error(this.formatMessage('error', message));
    if (error) {
      if (error.stack) {
        console.error(error.stack);
      } else {
        console.error(error);
      }
    }
  }

  debug(message: string, ...args: any[]): void {
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
      console.debug(this.formatMessage('debug', message), ...args);
    }
  }
}

export default Logger;
