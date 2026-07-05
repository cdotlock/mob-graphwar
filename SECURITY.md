# Security

Mob Graphwar is designed so models choose from legal candidate IDs instead of
writing arbitrary JavaScript or free-form functions.

## API Keys

- Offline local play does not need a key.
- Hosted provider mode must not persist user-provided keys.
- Keys must never be written to trace export, server logs, or client logs.
- Put server-owned keys in deployment environment variables.

## Reporting

Please open a GitHub issue with a minimal reproduction for security-sensitive
bugs. Do not include API keys or private provider responses in the issue body.
