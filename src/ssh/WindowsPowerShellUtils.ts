export function quotePowerShellLiteral(value: string): string {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

export function isWindowsPowerShellCommand(command: string): boolean {
  return /^\s*(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/i.test(String(command || ''));
}

function decodeCliXmlText(value: string): string {
  return String(value || '')
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function extractCliXmlMessages(xml: string): string {
  const messages: string[] = [];
  const text = String(xml || '');
  const streamTextPattern = /<S\s+S="(?:Error|Warning|Verbose|Debug|Information)"[^>]*>([\s\S]*?)<\/S>/g;
  let match: RegExpExecArray | null;

  while ((match = streamTextPattern.exec(text))) {
    const message = decodeCliXmlText(match[1]).trim();
    if (message) {
      messages.push(message);
    }
  }

  if (messages.length > 0) {
    return `${messages.join('\n')}\n`;
  }

  return '';
}

export function sanitizePowerShellCliXml(value: string): string {
  let text = String(value || '');
  if (!text.includes('#< CLIXML')) {
    return text;
  }

  let output = '';

  while (text) {
    const markerIndex = text.indexOf('#< CLIXML');
    if (markerIndex < 0) {
      output += text;
      break;
    }

    output += text.slice(0, markerIndex);
    text = text.slice(markerIndex + '#< CLIXML'.length).replace(/^\s*/, '');

    const closeIndex = text.indexOf('</Objs>');
    if (closeIndex < 0) {
      // Incomplete CLIXML usually means a PowerShell progress record split across
      // chunks. Drop it instead of leaking serialized XML into the UI.
      break;
    }

    const xmlBlock = text.slice(0, closeIndex + '</Objs>'.length);
    output += extractCliXmlMessages(xmlBlock);
    text = text.slice(closeIndex + '</Objs>'.length);
  }

  return output;
}

export function createPowerShellCliXmlStreamSanitizer(onText: (text: string) => void): { write(text: string): void; flush(): void } {
  let buffer = '';
  let insideCliXml = false;
  const maxBufferedCliXml = 1024 * 1024;

  const process = (final = false) => {
    while (buffer) {
      if (!insideCliXml) {
        const markerIndex = buffer.indexOf('#< CLIXML');
        if (markerIndex < 0) {
          if (final) {
            onText(buffer);
            buffer = '';
            return;
          }

          const keepLength = Math.min(buffer.length, '#< CLIXML'.length - 1);
          const emitLength = buffer.length - keepLength;
          if (emitLength > 0) {
            onText(buffer.slice(0, emitLength));
            buffer = buffer.slice(emitLength);
          }
          return;
        }

        if (markerIndex > 0) {
          onText(buffer.slice(0, markerIndex));
        }
        buffer = buffer.slice(markerIndex + '#< CLIXML'.length).replace(/^\s*/, '');
        insideCliXml = true;
      }

      const closeIndex = buffer.indexOf('</Objs>');
      if (closeIndex < 0) {
        if (final) {
          const extracted = extractCliXmlMessages(buffer);
          if (extracted) {
            onText(extracted);
          }
          buffer = '';
          insideCliXml = false;
          return;
        }

        if (buffer.length > maxBufferedCliXml) {
          buffer = buffer.slice(-4096);
        }
        return;
      }

      const xmlBlock = buffer.slice(0, closeIndex + '</Objs>'.length);
      const extracted = extractCliXmlMessages(xmlBlock);
      if (extracted) {
        onText(extracted);
      }
      buffer = buffer.slice(closeIndex + '</Objs>'.length);
      insideCliXml = false;
    }
  };

  return {
    write(text: string): void {
      buffer += String(text || '');
      process(false);
    },
    flush(): void {
      process(true);
    }
  };
}

export function buildWindowsPowerShellCommand(script: string): string {
  const normalizedScript = [
    "$ProgressPreference = 'SilentlyContinue'",
    "$VerbosePreference = 'SilentlyContinue'",
    "$DebugPreference = 'SilentlyContinue'",
    "$InformationPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Continue'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    String(script || '')
  ].join("\r\n");
  const encoded = Buffer.from(normalizedScript, 'utf16le').toString('base64');
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -OutputFormat Text -EncodedCommand ${encoded}`;
}

export function buildWindowsSetLocationScript(workingDirectory: string): string {
  const directory = String(workingDirectory || '').trim();
  return directory ? `Set-Location -LiteralPath ${quotePowerShellLiteral(directory)}` : '';
}

export function buildWindowsLogFollowCommand(remotePath: string, tailLines: number): string {
  const safeTailLines = Math.max(1, Math.min(50000, Math.floor(Number(tailLines) || 500)));
  return buildWindowsPowerShellCommand(`Get-Content -LiteralPath ${quotePowerShellLiteral(remotePath)} -Tail ${safeTailLines} -Wait`);
}

export function buildWindowsChecksumCommand(remotePath: string, algorithm: 'SHA256' | 'MD5'): string {
  return buildWindowsPowerShellCommand([
    `$hash = Get-FileHash -Algorithm ${algorithm} -LiteralPath ${quotePowerShellLiteral(remotePath)}`,
    'if ($hash -and $hash.Hash) { Write-Output $hash.Hash }'
  ].join("\r\n"));
}

export function buildWindowsSearchFileCommand(options: {
  scopePath: string;
  patterns: string[];
  includeSubdirectories: boolean;
  includeHiddenFiles: boolean;
  caseSensitive: boolean;
}): string {
  const patterns = options.patterns.length ? options.patterns : ['*'];
  const patternArray = patterns.map(quotePowerShellLiteral).join(', ');
  const recurse = options.includeSubdirectories ? ' -Recurse' : '';
  const hiddenFilter = options.includeHiddenFiles ? '' : " | Where-Object { -not ($_.Name.StartsWith('.')) -and -not ($_.Attributes -band [System.IO.FileAttributes]::Hidden) }";
  const caseSensitive = options.caseSensitive ? '$true' : '$false';

  return buildWindowsPowerShellCommand([
    `$patterns = @(${patternArray})`,
    `$caseSensitive = ${caseSensitive}`,
    `$root = ${quotePowerShellLiteral(options.scopePath)}`,
    `$items = Get-ChildItem -LiteralPath $root${recurse} -Force -ErrorAction SilentlyContinue`,
    `$items = $items${hiddenFilter}`,
    'foreach ($item in $items) {',
    '  $matched = $false',
    '  foreach ($pattern in $patterns) {',
    '    if ($caseSensitive) {',
    '      if ($item.Name -clike $pattern) { $matched = $true; break }',
    '    } else {',
    '      if ($item.Name -like $pattern) { $matched = $true; break }',
    '    }',
    '  }',
    '  if (-not $matched) { continue }',
    "  $type = if ($item.PSIsContainer) { 'D' } else { 'F' }",
    '  Write-Output ("{0}`t{1}" -f $type, $item.FullName)',
    '}'
  ].join("\r\n"));
}

export function buildWindowsSearchContentCommand(options: {
  scopePath: string;
  patterns: string[];
  includeSubdirectories: boolean;
  includeHiddenFiles: boolean;
  caseSensitive: boolean;
  textToFind: string;
}): string {
  const patterns = options.patterns.length ? options.patterns : ['*'];
  const patternArray = patterns.map(quotePowerShellLiteral).join(', ');
  const recurse = options.includeSubdirectories ? ' -Recurse' : '';
  const hiddenFilter = options.includeHiddenFiles ? '' : " | Where-Object { -not ($_.Name.StartsWith('.')) -and -not ($_.Attributes -band [System.IO.FileAttributes]::Hidden) }";
  const caseSensitive = options.caseSensitive ? '$true' : '$false';
  const selectCaseSensitive = options.caseSensitive ? ' -CaseSensitive' : '';

  return buildWindowsPowerShellCommand([
    `$patterns = @(${patternArray})`,
    `$caseSensitive = ${caseSensitive}`,
    `$needle = ${quotePowerShellLiteral(options.textToFind)}`,
    `$root = ${quotePowerShellLiteral(options.scopePath)}`,
    `$items = Get-ChildItem -LiteralPath $root${recurse} -Force -File -ErrorAction SilentlyContinue`,
    `$items = $items${hiddenFilter}`,
    'foreach ($item in $items) {',
    '  $matched = $false',
    '  foreach ($pattern in $patterns) {',
    '    if ($caseSensitive) {',
    '      if ($item.Name -clike $pattern) { $matched = $true; break }',
    '    } else {',
    '      if ($item.Name -like $pattern) { $matched = $true; break }',
    '    }',
    '  }',
    '  if (-not $matched) { continue }',
    `  Select-String -LiteralPath $item.FullName -Pattern $needle -SimpleMatch${selectCaseSensitive} -ErrorAction SilentlyContinue | ForEach-Object {`,
    '    $lineText = ($_.Line -replace "`r", "" -replace "`n", "")',
    '    Write-Output ("{0}`t{1}`t{2}" -f $_.Path, $_.LineNumber, $lineText)',
    '  }',
    '}'
  ].join("\r\n"));
}
