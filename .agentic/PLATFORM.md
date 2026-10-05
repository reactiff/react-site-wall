# Platform

Work within the repository's actual operating environment and toolchain. Do not assume a language, framework, package manager, shell, deployment platform, or operating system unless detected or specified.

Use existing dependencies and native platform capabilities where practical. Add dependencies only when they materially improve the implementation.

Use the repository's existing package/dependency manager and scripts.

## Portability
Handle paths and shell syntax safely for supported environments. Do not introduce platform-specific assumptions without need.

## Secrets
Never commit real credentials or expose secrets in logs, reports, screenshots, fixtures, or generated artifacts. Use the repository's established placeholder/example mechanism for configuration.
