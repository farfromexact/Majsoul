# Captures

Put real Mahjong Soul capture exports here while mapping protocol fields.

Files such as `*.json`, `*.jsonl`, and `*.txt` in this directory are ignored by git because they may contain session-specific table data. Keep only sanitized fixtures under `tests/fixtures/`.

Typical workflow:

```bash
npm run import-capture -- path/to/majsoul-helper-capture.json
npm run capture-doctor -- captures/capture-real.json
npm run replay -- captures/capture-real.json
npm run validate-captures
npm run validate-captures -- --summary
npm run validate-captures -- --require-real-page-ready
npm run real-page-gate
npm run audit
```

Use `import-capture` to copy a downloaded overlay export into this ignored directory before running the replay gates. With no source path, it searches the default Downloads folder for the newest `majsoul-helper-capture*.json`; it refuses to overwrite `captures/capture-real.json` unless you pass `--force` or choose another `--out` path. Use `capture-doctor` for the first human-readable diagnosis of one exported sample. Use `--summary` for quick triage after exporting several captures; keep the default JSON output for automation or detailed diagnostics. Use `real-page-gate` for final acceptance; it runs the strict real-page capture check and goal audit. The real-page-ready gate also checks `liveSafetySettings`, so keep realtime advice off, manual input empty, capture running, and the no-automation/no-message-mutation boundary intact for acceptance samples.
