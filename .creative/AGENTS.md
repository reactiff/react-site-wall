# Creative Agents

Creative is optional and dormant until a prompt begins with `.creative`.

When invoked, read these files in this exact order:

1. `PROTOCOL.md` — Arbiter, deliberation, runtime/session/stage/Git mechanics.
2. `GT-concepts.md` — normalized tactical reasoning axioms.
3. `ROLES.md` — specialist perspectives and assigned GT Concepts.
4. `TEAMS.md` — six three-specialist team compositions and selection guidance.

Then execute the request according to `PROTOCOL.md`. The Arbiter chairs a
collaborative session; specialists contribute from their expertise to one
shared objective. A role is never assigned a competing solution or a duty to
disagree.

Do not read or initialize runtime session folders until Creative is invoked.
Do not duplicate definitions across files: GT Concepts are defined only in
`GT-concepts.md`; roles only in `ROLES.md`; teams only in `TEAMS.md`.

The owner-facing switch is:

```text
.creative <prompt-or-action>
```

Natural language after `.creative` is authoritative. Infer intent rather than
requiring rigid command syntax.
