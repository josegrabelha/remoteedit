import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommandBatch } from '../multiTargetCommands/CommandBatch';
import { RemoteCommandService } from '../commands/RemoteCommandService';
import { buildControlledRemoteCommandScript } from '../ssh/RemoteCommandDisplay';
import { execFileSync } from 'node:child_process';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';

const target = (name: string) => ({ connectionId: name, name, workingDirectory: '/tmp' });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

test('bounded batches execute every target independently and isolate mixed stdout/stderr', async () => {
  let concurrent = 0, maximum = 0;
  const batch = new CommandBatch(['dev', 'tst', 'prod', 'other'].map(target), 'multiline\ncommand', () => {}, 2);
  await batch.run(async context => {
    maximum = Math.max(maximum, ++concurrent); context.setStatus('Running');
    context.append(context.execution.name + ' output\n', 'stdout');
    await flush(); concurrent--;
    if (context.execution.name === 'tst') { context.append('permission denied\n', 'stderr'); return { code: 1 }; }
    if (context.execution.name === 'prod') throw new Error('Connection timed out');
    return { code: 0 };
  });
  assert.equal(maximum, 2);
  assert.deepEqual(batch.executions.map(e => e.status), ['Finished', 'Failed', 'Failed', 'Finished']);
  assert.equal(batch.executions[1].stderr, 'permission denied\n');
  assert.match(batch.executions[2].output, /Error output: Connection timed out/);
  assert.match(batch.executions[2].output, /Suggested action:/);
  assert.equal(batch.executions[2].code, undefined);
  assert.equal(batch.executions[0].stdout, 'dev output\n');
  assert.equal(new Set(batch.executions.map(e => e.commandId)).size, 4);
  assert.ok(batch.executions.every(e => e.batchId === batch.id && e.finishedAt! >= e.startedAt!));
});

test('Stop All cancels active work and never starts pending targets or changes completed targets', async () => {
  const gate = deferred<{ code: number }>(); let stopped = 0; const started: string[] = [];
  const batch = new CommandBatch(['done', 'running', 'pending'].map(target), 'cmd', () => {}, 1);
  const running = batch.run(async context => {
    started.push(context.execution.name); context.setStatus('Running');
    context.setStop(() => { stopped++; gate.resolve({ code: 0 }); });
    return context.execution.name === 'done' ? { code: 0 } : gate.promise;
  });
  await flush(); batch.stop(); await running;
  assert.deepEqual(started, ['done', 'running']);
  assert.deepEqual(batch.executions.map(e => e.status), ['Finished', 'Stopped', 'Stopped']);
  assert.equal(stopped, 1); assert.equal(batch.executions[1].code, undefined);
  assert.equal(batch.executions[2].startedAt, undefined);
});

test('stopping one target preserves another execution and ignores its late completion/output', async () => {
  const gates = [deferred<{ code: number }>(), deferred<{ code: number }>()];
  const batch = new CommandBatch(['one', 'two'].map(target), 'cmd', () => {}, 2);
  const running = batch.run(async context => {
    context.setStatus('Running');
    const result = await gates[context.execution.name === 'one' ? 0 : 1].promise;
    context.append('late\n', 'stdout'); return result;
  });
  batch.stop(batch.executions[0].commandId);
  gates.forEach(gate => gate.resolve({ code: 0 })); await running;
  assert.deepEqual(batch.executions.map(e => e.status), ['Stopped', 'Finished']);
  assert.equal(batch.executions[0].output, '');
  assert.equal(batch.executions[1].stdout, 'late\n');
});

test('failed logical commands remain failures even if the final command exits zero', async () => {
  const batch = new CommandBatch([target('one')], 'false\ntrue', () => {});
  await batch.run(async context => { context.execution.failedCommands++; return { code: 0 }; });
  assert.equal(batch.executions[0].status, 'Failed'); assert.equal(batch.executions[0].code, 0);
});

test('sudo uses existing session support, does not prompt root/Windows, and clears failed elevation', async () => {
  let username = 'root', remotePlatform = 'posix', enabled = false, prompts = 0, fail = false;
  const sessions = {
    getConnection: () => ({ username, remotePlatform, connectionType: 'sftp' }),
    isSudoModeEnabled: () => enabled,
    enableSudoMode: async () => { if (fail) throw new Error('Bad password'); enabled = true; },
    disableSudoMode: () => { enabled = false; }
  } as unknown as RemoteSessionManager;
  const service = new RemoteCommandService(sessions); const prompt = async () => { prompts++; return 'synthetic'; };
  assert.equal(await service.prepareSudo('one', true, prompt), false);
  username = 'user'; remotePlatform = 'windows';
  assert.equal(await service.prepareSudo('one', true, prompt), false); assert.equal(prompts, 0);
  remotePlatform = 'posix'; assert.equal(await service.prepareSudo('one', true, prompt), true);
  await service.prepareSudo('one', true, prompt); assert.equal(prompts, 1);
  enabled = false; fail = true; await assert.rejects(service.prepareSudo('one', true, prompt), /Bad password/); assert.equal(enabled, false);
});
