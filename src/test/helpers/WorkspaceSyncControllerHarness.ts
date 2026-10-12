import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';

/**
 * Shared adapter for regression tests of private controller scheduling methods.
 * Parse the source once per test worker, but instantiate an isolated harness for
 * each test. Never share mutable controller state between cases.
 */
interface ControllerHarnessOptions {
  methods: string[];
  functions?: string[];
  preamble?: string;
  globals?: Record<string, unknown>;
}

let parsed: ts.SourceFile | undefined;
let controller: ts.ClassDeclaration | undefined;
const compiled = new Map<string, string>();

function source(): { tree: ts.SourceFile; klass: ts.ClassDeclaration } {
  if (!parsed) {
    const filename = path.resolve(__dirname, '../../../src/workspaceSync/WorkspaceSyncController.ts');
    parsed = ts.createSourceFile('WorkspaceSyncController.ts', fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.ES2022, true);
    controller = parsed.statements.find((statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === 'WorkspaceSyncController');
  }
  assert.ok(controller, 'WorkspaceSyncController must be present');
  return { tree: parsed, klass: controller };
}

export function workspaceSyncControllerHarness(options: ControllerHarnessOptions): Record<string, any> {
  const { tree, klass } = source();
  const key = JSON.stringify([options.methods, options.functions || [], options.preamble || '']);
  let code = compiled.get(key);
  if (!code) {
    const members = options.methods.map(name => {
      const member = klass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === name);
      assert.ok(member, `Controller.${name} must be present`);
      return member.getText(tree);
    });
    const helpers = (options.functions || []).map(name => {
      const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
      assert.ok(declaration, `Controller helper ${name} must be present`);
      return declaration.getText(tree).replace(/^export\s+/, '');
    });
    code = ts.transpileModule(
      `${options.preamble || ''}\n${helpers.join('\n')}\nclass Harness { ${members.join('\n')} }\nnew Harness();`,
      { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }
    ).outputText;
    compiled.set(key, code);
  }
  return runInNewContext(code, {
    setTimeout, clearTimeout, setImmediate, Date, Promise, ...options.globals
  }) as Record<string, any>;
}
