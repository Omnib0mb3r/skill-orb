/**
 * Signal coalescing for the daemon.
 *
 * Hooks send SIGUSR1 every N captured events. The daemon coalesces
 * these into at most one ingest pass at a time. If a signal arrives
 * while a pass is running, a "rerun" flag is latched and another pass
 * will start as soon as the current one finishes.
 */
export class SignalCoalescer {
  private running = false;
  private rerun = false;

  constructor(
    private readonly handler: () => Promise<void>,
    private readonly log: (msg: string) => void = () => undefined,
  ) {}

  trigger(reason: string): void {
    if (this.running) {
      this.rerun = true;
      this.log(`[signals] coalescing trigger (${reason}); pass already running`);
      return;
    }
    void this.run(reason);
  }

  private async run(reason: string): Promise<void> {
    this.running = true;
    try {
      do {
        this.rerun = false;
        this.log(`[signals] running pass: ${reason}`);
        try {
          await this.handler();
        } catch (err) {
          this.log(`[signals] handler error: ${(err as Error)?.message ?? err}`);
        }
      } while (this.rerun);
    } finally {
      this.running = false;
    }
  }
}
