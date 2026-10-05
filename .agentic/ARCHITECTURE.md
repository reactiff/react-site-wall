# Architecture

Build the smallest architecture that completely solves the problem.

Prefer direct composition, shallow structures, explicit dependencies and ownership, local state when sufficient, thin boundaries, replaceable adapters, ordinary platform capabilities, and modules with coherent purposes.

Avoid speculative infrastructure, premature abstraction, unnecessary service layers or state machinery, hidden mutation, giant multipurpose units, and generic frameworks created for a single use case.

Every abstraction must earn its existence.

## Preserve Intent
Understand intent before restructuring. Preserve deliberate project-specific patterns when effective. Distinguish broken implementation from intentional architecture. Recover before modernizing.

## Reuse
Before creating a new primitive, component, utility, parser, hook, abstraction, or style mechanism, search for an existing equivalent and follow coherent repository conventions.

## Public Contracts
Search consumers before changing exported interfaces or persisted contracts. When persisted data changes, keep canonical schemas, relationships, indexes, enums, and lifecycle definitions aligned when such specifications exist.
