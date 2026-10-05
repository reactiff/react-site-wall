# Creative Protocol

## Invocation

Creative mode is dormant unless a user prompt begins with:

```text
.creative
```

A period-prefixed `.creative` token is plain prompt syntax, not a shell command.

Primary forms:

```text
.creative <prompt>
.creative reject A
.creative reject all
.creative regenerate
.creative regenerate <additional direction>
.creative more
.creative more <additional direction>
.creative implement A
.creative implement A|B|all
.creative build A
.creative accept A
```

Interpret natural language by intent rather than requiring exact grammar.
`implement`, `build`, `make`, `develop`, or equivalent implementation intent
moves selected variants to Stage 2.

## Runtime workspace

On the first invocation, create runtime folders as needed:

```text
.creative/
  prompts/
  sessions/
```

Each new initiative creates:

```text
.creative/sessions/<initiative>/
  session.md
  references/
  variants/
  rejected/
  accepted/
```

Do not create empty asset folders unnecessarily.

Each new top-level session stores the initiating prompt verbatim in:

```text
.creative/prompts/<timestamp>-<initiative>.md
```

`session.md` records:
- initiative name;
- status: active | closed;
- stage: 1 | 2;
- selected team and roles;
- base branch and base commit;
- current variant context;
- prompt file;
- prompt amendments;
- Arbiter's shared problem frame: objective, context, constraints, challenges,
  and open questions;
- cumulative shared understanding, emerging concept, and formation or
  refinement phase for the current round;
- resolved concerns, live objections, and what would resolve them;
- variant lineage and disposition;
- implementation branch/commit when applicable;
- concise decisions and explicit owner feedback.

A closed session is immutable. These fields may be concise Markdown sections;
they are a public decision record, not a transcript or private reasoning log.
Update them after each Arbiter synthesis so later contributions inherit the
current state. Do not promote a single specialist's suggestion to the
emerging concept before the team has considered it.

## Session selection

Infer the active session from explicit language, current branch/variant lineage,
recent active session state, and relevant references. Ask only when ambiguity
would materially risk modifying the wrong session.

A new independent initiative starts a new session. Refinement of an existing
variant remains in the same session.

## Stage 1 — Creative exploration

### Evidence

Inspect only enough repository/product evidence to understand the request.
Treat existing implementation and prior decisions as evidence of intent, not
unchallengeable truth.

If `.creative/sessions/<initiative>/references/` contains material relevant to
the prompt, inspect it. References may include screenshots, annotations,
sketches, documents, or other owner-provided evidence.

### Arbiter and deliberation

The Arbiter chairs the session and represents the shared objective. It has no
specialist agenda, no seed of its own, and no competing proposal. It frames the
problem, invites specialists in team order, maintains the cumulative state,
reconciles contributions, and authors the current shared concept. It may ask a
specialist to examine a specific unresolved concern. It does not manufacture
conflict, decide by vote, or average incompatible suggestions.

1. Select the most relevant team from `TEAMS.md`, unless the owner selected
   one. Instantiate its three specialists with the GT Concepts in `ROLES.md`.
2. The Arbiter states the shared problem: what is being designed or solved,
   goals, context and evidence, constraints and owner invariants, known
   challenges, and important questions. Distinguish facts from assumptions.
3. Invite specialists sequentially in team order. Give each specialist the
   frame and all preceding contributions and syntheses. Each contributes
   observations, principles, constraints, risks, objections, patterns,
   opportunities, and improvements from its domain. It may suggest a useful
   mechanism, but does not own or defend a rival solution.
4. After all specialists have contributed, the Arbiter synthesizes agreements,
   complementary insights, tensions, and unresolved questions into the
   current shared understanding. Only then may it describe an emerging
   concept. A first suggestion is not itself a formed concept.
5. Continue sequential specialist and Arbiter turns as needed. Every turn
   starts from the latest shared understanding and responds to relevant prior
   contributions. Critique properties and consequences of the emerging idea,
   never another specialist's position. Resolve objections through evidence,
   a design change, or an explicit residual tradeoff. Do not restart settled
   questions without new evidence or a changed constraint.
6. The Arbiter marks the transition from **formation** to **refinement** when
   it can state a coherent central idea, show how the specialties' strongest
   compatible insights reinforce it, and identify any remaining uncertainty.
   Each specialist then has an opportunity to examine that whole concept and
   recommend improvements. The Arbiter incorporates compatible improvements
   and records why consequential objections remain or are resolved.
7. When the requested design space warrants alternatives, repeat this whole
   team process under distinct seeds to generate materially distinct variants,
   normally three. Variants are alternative outcomes of team deliberation,
   never proposals assigned to different specialists. Reconcile each enough
   to be internally coherent and reviewable.
8. Persist concise public synthesis and artifacts. Never serialize hidden
   chain-of-thought.

Consensus means a coherent solution at the intersection of the specialists'
concerns, not unanimity by dilution. A material unresolved objection is
recorded and carried into refinement or owner review; it is not silently
discarded to produce a variant.

### Turn context and public state

For each round, use this handoff contract whether specialists are separate
agents or perspectives enacted by one agent:

- **Arbiter frame:** effective owner prompt, relevant evidence, shared goal,
  known constraints and invariants, questions, selected team, and seed if this
  is a seeded variant round.
- **Specialist turn:** frame; latest Arbiter synthesis; all contributions since
  that synthesis; resolved and live concerns. Ask the specialist for domain
  observations, complementary patterns or mechanisms, consequences,
  constructive objections, and the next improvement to the shared concept.
  It must account for what earlier speakers have established. In refinement,
  give it the complete formed concept and ask for improvements to that whole.
- **Arbiter synthesis:** contributions since the prior synthesis; current
  shared understanding; compatible insights and how they reinforce one
  another; changes to the emerging concept; resolved and live concerns; next
  questions; phase (`formation` or `refinement`).

Keep a concise current state in `session.md` under these headings:

```text
## Problem frame
## Current round
## Shared understanding
## Emerging concept
## Concerns
## Decisions
```

`Current round` records the active variant ID or `unassigned`, seed if
applicable, phase (`formation` or `refinement`), and last completed speaker or
Arbiter synthesis so an interrupted session can resume without losing context.
`Concerns` distinguishes resolved concerns, with their resolution, from live
concerns and the evidence or design change needed to resolve them. Record material public
contributions or their concise substance when needed to explain a decision.
The state is cumulative: mark concerns resolved with the evidence or design
change, keep live concerns visible, and carry owner feedback forward. A
specialist's raw suggestion is attributed as a contribution; only Arbiter
synthesis becomes the shared concept. No verbatim internal prompt, hidden
reasoning, or fabricated transcript is required.

## Creative Seeds

Before generating variants for a round, generate one distinct creative seed for each requested variant.
Generate all seeds before deliberating on any variant so that earlier variants do not anchor later seed selection.
A seed is a small set of semantic biases that pushes exploration toward different solution territory. Examples include principles, metaphors, constraints, qualities, interaction models, structural tendencies, or tensions.

Seeds must be materially distinct from one another. They guide exploration but do not prescribe a solution.
Seeds must be generated independently of the current problem, goal, existing variants, and proposed solutions. Only after all seeds have been selected are they exposed to the team and Arbiter together with the problem.

Explicit instructions to keep, preserve, retain, hold, or not change something define invariants for the round. Creative seeds and deliberation may influence everything else but must not violate those invariants.

For each variant:

1. Assign exactly one seed.
2. Give the same seed to all three specialists and the Arbiter. The seed
   guides attention and associations; it assigns no specialist a position.
3. Each specialist interprets the seed through its own perspective and
   assigned GT Concepts while considering the cumulative conversation.
4. The Arbiter chairs formation, convergence, and refinement under that
   combined influence.
5. Generate the variant from the Arbiter's synthesis of the full team.

After all variants are generated, apply the Distinctness Gate. If two variants share substantially the same governing idea, regenerate the weaker one using a new seed.

Record the seed in the variant's `description.md`. Distinctness is judged by
the resulting governing ideas and owner-visible differences, not by how much
the specialists disagreed.

### Variant IDs

Top-level variants use uppercase letters:

```text
A
B
C
...
```

A refinement from a current variant appends another letter:

```text
B.A
B.B
B.C
```

Depth is unlimited:

```text
B.B.A
B.B.B
B.B.C
```

Variant IDs describe lineage. Never renumber an existing variant.

### Variant contents

Each variant lives at:

```text
sessions/<initiative>/variants/<variant-id>/
```

Every variant contains a minimal `description.md`. Its primary job is to make
the variant's **key differentiating factors** immediately clear: what this idea
does differently from its siblings, why that difference matters to the owner,
and what experience or behavior would change.

Treat Stage 1 as a mini whiteboard session, not premature specification or
implementation. `description.md` should be only as detailed as necessary to
understand, compare, accept, reject, refine, or select the idea for
implementation. Prefer concise behavior and contrasts over implementation
detail.

Include in description.md:
- The semantic seed that biased exploration for this variant.
- One sentence describing the central idea.
- The smallest set of characteristics that materially distinguish this variant from the others in the round.
- A concise multidisciplinary rationale: which compatible insights shaped the
  concept and any material unresolved objection or tradeoff. Keep it short
  enough for a whiteboard review.

Add supporting artifacts only when they communicate the idea more effectively:
- rough sketches;
- wireframes;
- mockups;
- annotated screenshots;
- flow or state diagrams;
- small interaction diagrams;
- tiny disposable prototypes when static media cannot communicate the idea.

Put supporting files in `assets/` only when needed. Do not create empty asset
folders.

Use the **cheapest artifact that makes the differentiating idea understandable
enough to review**. Do not require polished presentation, equal media across
variants, or production-quality artifacts.

For feature variants, do not copy or stage production source code under
`.creative/`. A feature may ultimately touch many repository files; Stage 1
represents it with `description.md` plus whatever lightweight whiteboard
artifacts make its behavior and differentiators clear. The actual multi-file
code change belongs to Stage 2 on the variant's Git branch.

For visual variants, the artifact itself may naturally be an image, sketch,
mockup, or other visual, with `description.md` briefly calling out the key
differences.

When variants share a common baseline, do not repeat the baseline at length.
Emphasize the delta. A reviewer should be able to answer quickly: **What is
different about A, B, and C?**

### Reject

```text
.creative reject A
.creative reject A|C
.creative reject all
```

Move rejected variant directories from `variants/` to `rejected/`. Preserve
their IDs and provenance. If implemented, do not silently delete their Git
branches until session closure unless the owner explicitly requests cleanup.

Rejecting implementations returns the session to Stage 1 while preserving the
same session and prompt history.

### Regenerate / more

```text
.creative regenerate
.creative more
```

Use the last effective prompt in the current session.

Trailing language amends the effective prompt rather than replacing it unless
the owner clearly says otherwise:

```text
.creative regenerate but keep B's navigation
.creative more only make the card denser
.creative regenerate combine A's header with C's controls
```

Record amendments in `session.md`.

Explicit references to prior variants authorize reuse of those elements,
including rejected variants. New variants receive new IDs in the current
lineage; do not overwrite old variants.

### Refinement from a branch/variant

If the owner is reviewing variant `B` (for example, currently on Git branch
`B`) and says:

```text
.creative improve the styling of the card
```

treat `B` as the current variant context and generate children:

```text
B.A
B.B
B.C
```

If references were added under the session's `references/`, inspect them when
the prompt points to them or they are clearly relevant.

Further reject/regenerate cycles stay within that lineage. There is no depth
limit.

## Stage 2 — Implementation

Implementation intent means: make the selected variant real in the repository.

Before implementation:
- require a Git repository;
- require a clean enough worktree to avoid overwriting unrelated owner work;
- record the session base branch and base commit;
- never push.

For every selected variant, including when only one is selected:

1. Create a Git branch named exactly as the variant ID (`A`, `B`, `B.A`, etc.).
2. Top-level variant branches start from the recorded session base commit.
3. Nested variant branches start from their implemented parent variant branch
   when available; otherwise reconstruct the parent state safely from recorded
   lineage before applying the child delta.
4. Implement the actual requested feature/restyle/change, not merely a mockup.
5. Run proportionate verification required by the repository instructions.
6. Commit all variant implementation changes on that branch.
7. Record branch and commit in `session.md`.
8. Do not push.

When multiple variants are implemented, each must remain an independently
switchable branch.

Do not merge variants merely because implementation succeeded.

Variant branches are intentionally temporary and terse. Their exact IDs are a
terminal UX feature: the owner should be able to use commands such as
`git switch B` or `git switch B.A`. Do not namespace, prefix, or lengthen them.
They are recycled across sessions after the prior session closes and its
Creative branches are deleted.

## Reject after implementation

An implemented variant may still be rejected. Move its creative artifact from
`variants/` to `rejected/`, mark the branch rejected in session state, return
to Stage 1, and preserve the branch until final acceptance/closure unless the
owner explicitly requests earlier deletion.

Regeneration after rejection continues in the same session.

## Acceptance

Exactly one variant can be accepted:

```text
.creative accept B.B
```

Acceptance is terminal for the session.

Before accepting:
- the variant must have an implementation branch and commit;
- verify the worktree is safe for branch operations;
- identify the recorded session base branch.

Then:

1. Switch to the recorded base branch.
2. Merge the accepted variant branch.
3. Resolve only mechanical conflicts that preserve the accepted result; surface
   material ambiguity.
4. Run proportionate post-merge verification.
5. Commit the merge if Git did not already create the required commit.
6. Move the accepted artifact directory to `accepted/`.
7. Move every other surviving variant artifact to `rejected/`.
8. Mark every nonaccepted implementation branch rejected.
9. Delete all session variant branches, including nested branches, after the
   accepted merge is safely committed.
10. Mark `session.md` status `closed` and record the accepted variant and merge
    commit.

Never push.

After closure, no `.creative` command may mutate that session. A new request
creates a new session, even if it builds on the accepted result.

## Git safety

Creative Git operations must preserve unrelated owner work.

Never:
- force-push;
- push automatically;
- reset away unrelated changes;
- delete branches outside the active creative session;
- accept more than one variant;
- reuse an existing unrelated branch merely because its name collides.

Because variant branch names are intentionally short, exact, temporary, and
recyclable, normal closure deletes them so the next session can reuse `A`, `B`,
`C`, and descendants. If an expected-to-be-free name already exists when a new
implementation begins, surface the collision rather than overwriting or
automatically renaming it.

## Deliberation record

Persist only inspectable creative output:
- observations;
- proposals;
- objections;
- assumptions;
- concise rationale;
- alternatives;
- owner feedback;
- decisions;
- unresolved questions;
- provenance.

Do not persist private chain-of-thought.

## Compatibility and migration

The invocation syntax, session folders, variant IDs, lineage, reject and
regenerate behavior, Stage 2 branch names, implementation, and acceptance
rules remain valid. Existing seeds continue to bias a whole team, not to
assign opposing specialist positions. Existing variant descriptions remain
reviewable without rewriting their provenance.

For an active session created under an earlier protocol, preserve its prompt,
team, variants, IDs, feedback, and Git records. On the next Creative turn,
have the Arbiter summarize the existing public decisions and artifacts into
the new `Problem frame`, `Shared understanding`, `Emerging concept`, and
`Concerns` sections of `session.md`. Mark any reconstructed state as a summary
of existing records, not as a conversation that did not occur. Continue with
sequential specialist review and synthesis from that point. If a prior
variant was produced by one specialist, treat it as an existing candidate for
team examination, not as an already settled central concept. Do not mutate a
closed session; use its accepted result only as evidence for a new session.

## Default behavior

The protocol should feel conversational rather than command-heavy. Infer:
- current session;
- current lineage from branch/state;
- whether trailing text amends the last prompt;
- whether a verb means Stage 1 exploration or Stage 2 implementation;
- which references are relevant;
- which team best fits.

Prefer doing the obvious safe thing over asking the owner to restate protocol
syntax.
