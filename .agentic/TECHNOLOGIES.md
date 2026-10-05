# Technology Provisions

Apply a provision only when that technology is actually present in the repository. These provisions add technology-specific guidance; they do not replace the technology-agnostic baseline.

## JavaScript / Node.js
When a JavaScript or Node project is detected, respect its existing module system, runtime version, package manager, scripts, linting, formatting, and test conventions. Do not convert module systems or package managers without a task requirement.

## TypeScript
When TypeScript is detected, keep types useful and precise, avoid `any` except at genuine external boundaries, preserve exported contracts unless intentionally changing them, and use the repository's configured compiler/typecheck workflow.

## React
When React is detected, preserve the project's component and state conventions. Prefer composition. Avoid unnecessary global state. Prevent stale closures, leaked listeners/timers/observers, duplicated subscriptions, and unbounded render loops. Keep high-frequency work outside rendered state when rendering every event is unnecessary.

## Vite
When Vite is detected, work with its existing configuration, aliases, plugins, environment conventions, and development/build scripts rather than layering on redundant tooling.

## Vitest
When Vitest is already present, prefer its native watch mode for continuous deterministic test execution. Do not require the coding agent to wait for the watch process after every edit.

## Jest
When Jest is already present, use its established test and watch workflows rather than migrating to Vitest without an explicit reason.

## Python
When Python is detected, respect the existing environment, dependency manager, formatter/linter, type checker, test framework, packaging structure, and supported interpreter versions. Do not introduce Node-oriented conventions into Python-only projects.

## Other Technologies
Infer applicable conventions from repository manifests, configuration, documentation, and existing code. Preserve the existing stack rather than forcing a preferred one.
