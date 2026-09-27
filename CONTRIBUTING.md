# Contributing to Remote Edit

Thank you for your interest in contributing to Remote Edit.

## Pull Requests

Please open an issue before submitting significant new functionality so the
proposed approach can be discussed first.

Pull requests should target the `main` branch.

Please keep changes focused and include relevant tests and documentation
updates where applicable.

## Testing

Run `npm ci` and `npm test` for compilation and the Node test suite, including
editor root naming, URI round trips, and virtual directory mapping.

Optional editor integration tests run in an isolated VS Code profile:

```powershell
$env:VSCODE_EXECUTABLE = 'C:\path\to\VS Code\Code.exe'
npm run test:editor-root-label
```

On macOS or Linux, set `VSCODE_EXECUTABLE` to the VS Code application executable
before running the same npm command. The tests use in-memory remote sessions
and do not load saved connection credentials. They cover file opening, saving,
read-only and comparison editors, and dirty/undo state across setting changes.

## Contribution License

By submitting a pull request or other contribution to Remote Edit, you
confirm that you have the right to submit the contribution and agree to the
contribution terms described in the project's LICENSE file.

Submitting a contribution does not guarantee that it will be accepted or
included in a release.
