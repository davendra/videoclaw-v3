/**
 * Console output capture utility for E2E tests
 */

export class ConsoleCapture {
  private logs: string[] = [];
  private originalLog: typeof console.log = console.log;
  private isCapturing: boolean = false;

  /**
   * Start capturing console.log output
   */
  start(): void {
    if (this.isCapturing) return;
    this.logs = [];
    this.originalLog = console.log;
    this.isCapturing = true;
    console.log = (...args: any[]) => {
      this.logs.push(args.map(String).join(" "));
    };
  }

  /**
   * Stop capturing and restore original console.log
   */
  stop(): void {
    if (!this.isCapturing) return;
    console.log = this.originalLog;
    this.isCapturing = false;
  }

  /**
   * Get all captured output as a single string
   */
  getOutput(): string {
    return this.logs.join("\n");
  }

  /**
   * Get captured output as array of lines
   */
  getLines(): string[] {
    return [...this.logs];
  }

  /**
   * Check if output contains a specific text
   */
  contains(text: string): boolean {
    return this.getOutput().includes(text);
  }

  /**
   * Check if any line matches a pattern
   */
  matchesPattern(pattern: RegExp): boolean {
    return this.logs.some(line => pattern.test(line));
  }

  /**
   * Clear captured logs without stopping capture
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Count occurrences of a text in output
   */
  countOccurrences(text: string): number {
    return this.logs.filter(line => line.includes(text)).length;
  }
}

// Singleton instance for convenience
export const capture = new ConsoleCapture();
