import { shellQuote } from '../utils/shellUtils';
import type { RemoteCommandStreamingCallbacks } from '../remote/RemoteSessionTypes';

export interface RemoteCommandDisplayScript {
  readonly script: string;
  flush: () => void;
  commandMarkerPrefix?: string;
  statusMarkerPrefix?: string;
  markerMap?: Map<string, string>;
  maxMarkerLength?: number;
}

export function buildControlledRemoteCommandScript(
  workingDirectory: string,
  commandScript: string,
  pidMarkerPrefix: string,
  redirectInputFromNull: boolean
): string {
  const inputRedirectLine = redirectInputFromNull ? 'exec </dev/null' : '';
  const scriptLines = [
    `cd ${shellQuote(workingDirectory)} || exit $?`,
    inputRedirectLine,
    'if command -v setsid >/dev/null 2>&1; then',
    `  setsid sh -c ${shellQuote(commandScript)} &`,
    'else',
    `  sh -c ${shellQuote(commandScript)} &`,
    'fi',
    '__remote_edit_command_pid=$!',
    `printf '%s%s%s\n' ${shellQuote(pidMarkerPrefix)} "$__remote_edit_command_pid" ${shellQuote('__')}`,
    'wait "$__remote_edit_command_pid" 2>/dev/null',
    '__remote_edit_wait_status=$?',
    'exit "$__remote_edit_wait_status"'
  ];

  return scriptLines.filter(line => line !== '').join('\n');
}

export function buildRemoteCommandDisplayScript(command: string): RemoteCommandDisplayScript {
  const logicalCommands = splitRemoteCommandForDisplay(command);
  const markerToken = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const commandMarkerPrefix = `__REMOTE_EDIT_COMMAND_${markerToken}_`;
  const statusMarkerPrefix = `__REMOTE_EDIT_COMMAND_STATUS_${markerToken}_`;
  const markerMap = new Map<string, string>();

  const scriptParts: string[] = ['__remote_edit_last_status=0'];

  logicalCommands.forEach((logicalCommand, index) => {
    const commandMarker = `${commandMarkerPrefix}${index}__`;
    const statusMarkerPrefixForCommand = `${statusMarkerPrefix}${index}_`;
    markerMap.set(commandMarker, logicalCommand);
    const commandMarkerPrinter = index === 0
      ? `printf '%s\n' ${shellQuote(commandMarker)}`
      : `printf '\n%s\n' ${shellQuote(commandMarker)}`;

    scriptParts.push(commandMarkerPrinter);
    scriptParts.push(logicalCommand);
    scriptParts.push('__remote_edit_command_status=$?');
    scriptParts.push('__remote_edit_last_status=$__remote_edit_command_status');
    scriptParts.push(`printf '%s%s%s\n' ${shellQuote(statusMarkerPrefixForCommand)} "$__remote_edit_command_status" ${shellQuote('__')}`);
  });

  scriptParts.push('exit $__remote_edit_last_status');
  const script = scriptParts.join('\n');

  const maxCommandMarkerLength = Array.from(markerMap.keys()).reduce((max, marker) => Math.max(max, marker.length), 0);
  const maxStatusMarkerLength = statusMarkerPrefix.length + String(Math.max(0, logicalCommands.length - 1)).length + 1 + 16 + 2;

  return {
    script,
    flush: () => undefined,
    commandMarkerPrefix,
    statusMarkerPrefix,
    markerMap,
    maxMarkerLength: Math.max(maxCommandMarkerLength, maxStatusMarkerLength)
  };
}

export function createRemoteCommandDisplayCallbacks(
  displayScript: RemoteCommandDisplayScript,
  callbacks: RemoteCommandStreamingCallbacks
): RemoteCommandStreamingCallbacks {
  const commandMarkerPrefix = String(displayScript.commandMarkerPrefix || '');
  const statusMarkerPrefix = String(displayScript.statusMarkerPrefix || '');
  const markerMap = displayScript.markerMap;
  const maxMarkerLength = Number(displayScript.maxMarkerLength || 0);
  const commandMarkerPattern = commandMarkerPrefix ? new RegExp(`${escapeRegExp(commandMarkerPrefix)}\\d+__`) : undefined;
  const statusMarkerPattern = statusMarkerPrefix ? new RegExp(`${escapeRegExp(statusMarkerPrefix)}(\\d+)_(\\d+)__`) : undefined;
  const markerPattern = commandMarkerPrefix || statusMarkerPrefix
    ? new RegExp([
      commandMarkerPrefix ? `${escapeRegExp(commandMarkerPrefix)}\\d+__` : '',
      statusMarkerPrefix ? `${escapeRegExp(statusMarkerPrefix)}\\d+_\\d+__` : ''
    ].filter(Boolean).join('|'))
    : undefined;
  let pendingStdout = '';

  const emitStdout = (text: string) => {
    if (text) {
      callbacks.onStdout?.(text);
    }
  };

  const processStdout = (chunk: string) => {
    if (!chunk || !markerPattern || !markerMap || !maxMarkerLength) {
      emitStdout(chunk);
      return;
    }

    pendingStdout += chunk;

    while (pendingStdout) {
      markerPattern.lastIndex = 0;
      const match = markerPattern.exec(pendingStdout);

      if (!match) {
        const keepLength = getPotentialRemoteCommandDisplayMarkerSuffixLength(
          pendingStdout,
          commandMarkerPrefix,
          statusMarkerPrefix,
          maxMarkerLength
        );
        if (pendingStdout.length > keepLength) {
          const emitLength = pendingStdout.length - keepLength;
          emitStdout(pendingStdout.slice(0, emitLength));
          pendingStdout = pendingStdout.slice(emitLength);
        }
        return;
      }

      if (match.index > 0) {
        emitStdout(pendingStdout.slice(0, match.index));
      }

      const marker = match[0];
      if (commandMarkerPattern?.test(marker)) {
        commandMarkerPattern.lastIndex = 0;
        const command = markerMap.get(marker);
        if (command) {
          callbacks.onCommand?.(command);
        }
      } else if (statusMarkerPattern) {
        statusMarkerPattern.lastIndex = 0;
        const statusMatch = statusMarkerPattern.exec(marker);
        if (statusMatch) {
          callbacks.onCommandStatus?.(Number(statusMatch[1]), Number(statusMatch[2]));
        }
      }

      pendingStdout = pendingStdout.slice(match.index + marker.length);
      if (pendingStdout.startsWith('\r\n')) {
        pendingStdout = pendingStdout.slice(2);
      } else if (pendingStdout.startsWith('\n')) {
        pendingStdout = pendingStdout.slice(1);
      } else if (pendingStdout.startsWith('\r')) {
        pendingStdout = pendingStdout.slice(1);
      }
    }
  };

  displayScript.flush = () => {
    if (pendingStdout) {
      emitStdout(pendingStdout);
      pendingStdout = '';
    }
  };

  return {
    ...callbacks,
    onStdout: processStdout,
    onStderr: callbacks.onStderr
  };
}

function splitRemoteCommandForDisplay(command: string): string[] {
  const normalized = String(command || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  if (!normalized) {
    return [];
  }

  if (shouldKeepRemoteCommandAsSingleBlock(normalized)) {
    return [normalized];
  }

  const logicalCommands: string[] = [];
  const currentLines: string[] = [];

  for (const line of normalized.split('\n')) {
    if (!currentLines.length && !line.trim()) {
      continue;
    }

    currentLines.push(line);

    if (isShellLineContinued(line)) {
      continue;
    }

    const logicalCommand = currentLines.join('\n').trim();
    if (logicalCommand) {
      logicalCommands.push(logicalCommand);
    }
    currentLines.length = 0;
  }

  const trailingCommand = currentLines.join('\n').trim();
  if (trailingCommand) {
    logicalCommands.push(trailingCommand);
  }

  return logicalCommands.length ? logicalCommands : [normalized];
}

function shouldKeepRemoteCommandAsSingleBlock(command: string): boolean {
  const lines = command.split('\n').map(line => line.trim()).filter(Boolean);

  if (lines.length <= 1) {
    return false;
  }

  return lines.some(line =>
    /<<[-]?\s*['"]?\w+['"]?/.test(line) ||
    /^(if|for|while|until|case|select)\b/.test(line) ||
    /\b(then|do)\s*$/.test(line) ||
    /^(elif|else|fi|done|esac)\b/.test(line) ||
    /^\{\s*$/.test(line) ||
    /^\}\s*$/.test(line)
  );
}

function isShellLineContinued(line: string): boolean {
  const trimmedRight = String(line || '').replace(/[ \t]+$/g, '');
  let trailingBackslashes = 0;

  for (let index = trimmedRight.length - 1; index >= 0 && trimmedRight[index] === '\\'; index -= 1) {
    trailingBackslashes += 1;
  }

  return trailingBackslashes > 0 && trailingBackslashes % 2 === 1;
}

export function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPotentialRemoteCommandDisplayMarkerSuffixLength(
  text: string,
  commandMarkerPrefix: string,
  statusMarkerPrefix: string,
  maxMarkerLength: number
): number {
  return getPotentialMarkerSuffixLength(text, maxMarkerLength, suffix => {
    if (commandMarkerPrefix && isPotentialNumberMarkerSuffix(suffix, commandMarkerPrefix)) {
      return true;
    }

    if (!statusMarkerPrefix) {
      return false;
    }

    if (statusMarkerPrefix.startsWith(suffix)) {
      return true;
    }

    if (!suffix.startsWith(statusMarkerPrefix)) {
      return false;
    }

    const rest = suffix.slice(statusMarkerPrefix.length);
    return /^\d*(?:_\d*)?(?:_{0,2})?$/.test(rest);
  });
}

export function getPotentialRemoteProcessPidMarkerSuffixLength(text: string, pidMarkerPrefix: string, maxMarkerLength: number): number {
  if (!pidMarkerPrefix) {
    return 0;
  }

  return getPotentialMarkerSuffixLength(text, maxMarkerLength, suffix => isPotentialNumberMarkerSuffix(suffix, pidMarkerPrefix));
}

function getPotentialMarkerSuffixLength(text: string, maxMarkerLength: number, isPotentialMarkerSuffix: (suffix: string) => boolean): number {
  const maxLength = Math.min(Math.max(0, maxMarkerLength - 1), text.length);

  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = text.slice(text.length - length);
    if (isPotentialMarkerSuffix(suffix)) {
      return length;
    }
  }

  return 0;
}

function isPotentialNumberMarkerSuffix(suffix: string, markerPrefix: string): boolean {
  if (!suffix) {
    return false;
  }

  if (markerPrefix.startsWith(suffix)) {
    return true;
  }

  if (!suffix.startsWith(markerPrefix)) {
    return false;
  }

  const rest = suffix.slice(markerPrefix.length);
  return /^\d*(?:_{0,2})?$/.test(rest);
}
