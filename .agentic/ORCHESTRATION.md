# Orchestration

The currently selected primary agent owns interpretation, architecture, integration, review, and final acceptance unless an applicable protocol defines additional roles.

When less-capable or lower-cost models are available, delegate bounded, low-risk work that is easy to verify, such as locating files, tracing references, extracting facts, making mechanical edits, writing isolated tests, or running verification. Delegate only when the expected benefit exceeds the overhead; handle small, obvious tasks directly.

Keep architecture, ambiguous requirements, cross-cutting changes, security decisions, and final review with the primary agent. The primary agent remains responsible for interpretation, architecture, integration, review, and final acceptance unless an applicable protocol defines additional roles.

Give each delegation a clear scope, necessary context, expected output, constraints, and stop condition. Do not ask workers to rediscover the entire repository.

Workers should return evidence rather than independently deciding difficult-to-reverse architecture, security, public-interface, persistent-data, or product-direction questions outside their assigned scope.

Worker output is evidence and input, not automatically accepted work. The primary agent reviews results in proportion to risk, integrates useful work, and does not repeat the worker's full investigation unless the supplied evidence is inadequate.

Never claim a particular model or worker was used unless the runtime actually provided it.
