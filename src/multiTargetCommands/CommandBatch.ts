import { randomUUID } from 'crypto';
import type { RemoteCommandStreamingControl } from '../remote/RemoteSessionTypes';

export type ExecutionStatus = 'Pending' | 'Connecting' | 'Running' | 'Finished' | 'Failed' | 'Stopped';
export interface CommandTarget { connectionId: string; name: string; workingDirectory: string; }
export interface CommandExecution extends CommandTarget {
  batchId: string; commandId: string; status: ExecutionStatus;
  startedAt?: number; finishedAt?: number; code?: number;
  output: string; stdout: string; stderr: string; truncated?: boolean; failedCommands: number;
}
export interface CommandExecutionContext {
  execution: CommandExecution;
  isStopped(): boolean;
  setStatus(status: ExecutionStatus): void;
  append(text: string, stream?: 'stdout' | 'stderr'): void;
  setStop(stop: () => void): void;
  setControl(control: RemoteCommandStreamingControl): void;
}
const OUTPUT_LIMIT = 512 * 1024;
export function isExecutionActive(status: ExecutionStatus): boolean {
  return status === 'Pending' || status === 'Connecting' || status === 'Running';
}

/** A bounded worker queue. All callbacks belong to this batch, never the selected row. */
export class CommandBatch {
  readonly id = randomUUID();
  readonly executions: CommandExecution[];
  private readonly stops = new Map<string, () => void>();
  private readonly controls = new Map<string, RemoteCommandStreamingControl>();
  private started = false;
  constructor(targets: CommandTarget[], readonly command: string, private readonly changed: (execution: CommandExecution) => void,
    private readonly concurrency = 5) {
    this.executions = targets.map(target => ({ ...target, batchId: this.id, commandId: randomUUID(), status: 'Pending',
      output: '', stdout: '', stderr: '', failedCommands: 0 }));
  }
  get active(): boolean { return this.executions.some(item => isExecutionActive(item.status)); }
  stop(commandId?: string): void {
    for (const item of this.executions) {
      if ((!commandId || item.commandId === commandId) && isExecutionActive(item.status)) {
        item.status = 'Stopped'; item.finishedAt = Date.now();
        this.controls.get(item.commandId)?.stop(); this.stops.get(item.commandId)?.();
        this.changed(item);
      }
    }
  }
  async run(execute: (context: CommandExecutionContext) => Promise<{ code: number }>): Promise<void> {
    if (this.started) throw new Error('This command batch has already started.');
    this.started = true;
    let next = 0;
    const worker = async () => {
      while (next < this.executions.length) {
        const item = this.executions[next++];
        if (item.status === 'Stopped') continue;
        item.startedAt = Date.now();
        const isStopped = () => item.status === 'Stopped';
        const append = (text: string, stream?: 'stdout' | 'stderr') => {
          if (item.status === 'Stopped') return;
          item.output += text;
          if (item.output.length > OUTPUT_LIMIT) { item.output = item.output.slice(-OUTPUT_LIMIT); item.truncated = true; }
          if (stream) item[stream] = (item[stream] + text).slice(-OUTPUT_LIMIT);
          this.changed(item);
        };
        try {
          const result = await execute({ execution: item, isStopped, append,
            setStatus: status => { if (item.status !== 'Stopped') { item.status = status; this.changed(item); } },
            setStop: stop => { this.stops.set(item.commandId, stop); if (item.status === 'Stopped') stop(); },
            setControl: control => { this.controls.set(item.commandId, control); if (item.status === 'Stopped') control.stop(); }
          });
          if (!isStopped()) {
            item.code = result.code;
            item.status = result.code === 0 && !item.failedCommands ? 'Finished' : 'Failed';
            append(`\nProcess exited with code ${result.code}.\n`);
            if (item.failedCommands) append(`${item.failedCommands} command(s) failed.\n`);
            if (item.status === 'Failed') append('Suggested action: Review the error output, command, working directory, and remote permissions.\n');
          }
        } catch (error) {
          if (!isStopped()) {
            item.status = 'Failed';
            append(`\nError output: ${error instanceof Error ? error.message : String(error)}\nSuggested action: Verify the host, port, network, SSH credentials, working directory, and remote permissions.\n`);
          }
        } finally {
          item.finishedAt ??= Date.now(); this.stops.delete(item.commandId); this.controls.delete(item.commandId); this.changed(item);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, this.concurrency), this.executions.length) }, worker));
  }
}
