## 1.0.2

### Added

- Real-time progress logging during AI enrichment
- Token usage reporting for each enrichment stage
- Streaming chunk updates during long operations

### Changed

- Default logger changed from `nullLogger` to `consoleLogger` - progress shown by default
- Use `nullLogger` to disable output

### Example output
```
[INFO] [fields] Starting...
[DEBUG] [fields] 20 chunks...
[DEBUG] [fields] 40 chunks...
[INFO] [fields] Completed - 368 tokens
```