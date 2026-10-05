# Operations

## Working Style
- Inspect before modifying.
- Preserve intended behavior unless change is requested or clearly broken.
- Prefer the smallest complete solution.
- Avoid broad rewrites when a focused change is sufficient.
- Preserve unrelated user work and untracked files.
- Do not invent requirements or repository facts.
- Stop discovery when enough evidence exists to work safely.
- Escalate difficult-to-reverse decisions involving architecture, security, public interfaces, persistent data, or product behavior.
- Treat tokens, tool calls, repository reads, and worker invocations as costs. Gather the minimum evidence needed for the requested work and do not scan broadly just to increase confidence.
- Reuse facts already established in the current task; do not rediscover them without a specific reason to doubt or update them.
- Prefer direct execution for small, obvious tasks over unnecessary delegation or orchestration.

## Discovery
Use progressive, targeted discovery. Read repository instructions, manifests/configuration, directly relevant source, tests, consumers, and dependencies as needed. Avoid indiscriminate repository-wide scans.

Choose the smallest set of reads and checks that can establish a safe, correct change. Broaden discovery only when a concrete uncertainty or dependency requires it.

Before modifying shared code, identify relevant consumers, tests, data flow, and repository state.

## Scope
Stay inside requested scope. Do not opportunistically redesign unrelated areas, migrate technologies, rename broad interfaces, or reformat the repository wholesale.

## Completion
A task is complete when the requested behavior exists, intended behavior is preserved, relevant obligations are satisfied, unrelated work is untouched, and repository state is intentional. Report outcomes concisely and do not claim checks that were not actually observed.
