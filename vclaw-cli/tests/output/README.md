# Test Output Directory

This directory contains structured test outputs organized by date and test type.

## Directory Structure

```
tests/output/
├── README.md                     # This file
├── latest/                       # Symlink to most recent run
└── YYYY-MM-DD_HH-MM-SS/          # Timestamped test run folders
    ├── summary.json              # Machine-readable summary
    ├── summary.md                # Human-readable summary
    ├── unit/                     # Unit test results
    │   ├── output.log            # Full test output
    │   ├── results.json          # Parsed results
    │   └── failures/             # Failed test details (if any)
    ├── integration/              # Integration test results
    │   ├── output.log
    │   ├── results.json
    │   └── artifacts/            # Generated files (images, videos)
    ├── e2e/                      # End-to-end test results
    │   ├── output.log
    │   ├── results.json
    │   └── artifacts/
    └── coverage/                 # Code coverage reports (optional)
```

## Running Tests

```bash
# Run all tests with structured output
./tests/run-all-tests.sh

# Run specific test categories
./tests/run-all-tests.sh --unit          # Unit tests only
./tests/run-all-tests.sh --integration   # Integration tests only
./tests/run-all-tests.sh --e2e           # E2E tests only

# View latest results
cat tests/output/latest/summary.md
```

## Test Categories

| Category | Description | Credentials | Cost |
|----------|-------------|-------------|------|
| Unit | Pure function tests, no I/O | None | $0 |
| Integration | API calls, DB operations | USEAPI_* env vars | ~$0.15 |
| E2E | Full video generation | USEAPI_* or cookie.json | ~$1.00 |

## Environment Variables

```bash
# Required for integration/E2E tests
USEAPI_API_TOKEN=user:XXXX-XXXXXXXXXX
USEAPI_ACCOUNT_EMAIL=your-email@gmail.com
```
