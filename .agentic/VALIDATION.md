# Validation

## Test Responsibility
Maintain appropriate automated coverage using the repository's existing testing conventions and technology stack.

When behavior changes, add or update relevant tests when useful. Do not weaken tests merely to accommodate broken behavior.

## Execution Model
Routine interactive work does not require waiting for the full validation suite after every change.

Make verification effort proportional to the change's risk and how directly its result can be observed. Simple changes that can be checked locally, manually, or visually do not require a heavyweight validation workflow unless requested or otherwise required by a defined gate.

Prefer continuous deterministic verification running independently of the coding agent when the repository supports it. The continuous verifier must not invoke AI or require an agent to interpret routine pass/fail results.

Use the repository's native deterministic tooling and watch modes where available rather than inventing an AI-driven verifier.

Run validation synchronously when specifically requested, diagnosing a failure, necessary to establish correctness, or at an explicit checkpoint such as release, merge, milestone, or protocol-defined gate.

Never claim a test, build, lint, typecheck, browser check, or other validation passed unless its result was actually observed.

An attempted verification that fails or cannot be completed remains unresolved and must be reported as such. Do not replace missing or failed evidence with assumptions about what would have happened.

## Technology Detection
Use only validation tools applicable to the detected repository. Do not introduce a testing framework merely because Agentic recognizes it. Existing project conventions take precedence.
