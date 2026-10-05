# SiteWall — React Package Specification

## 1. Purpose

SiteWall is a reusable TypeScript React development package that provides a live, holistic, interactive representation of an application.

Instead of examining pages individually, SiteWall presents many application routes simultaneously on a shared spatial surface. Humans and software agents can inspect the application as a whole, focus individual pages, interact with them, navigate through user journeys, edit styling, and evaluate the effects across the complete application.

Primary uses include:

- holistic visual design;
- cross-page styling and consistency;
- responsive design;
- user-journey testing;
- navigation and redirect testing;
- authentication and shared-state testing;
- scroll-dependent experience testing;
- live stylesheet development;
- agent-driven application exploration;
- Creative-agent analysis of the application as a complete system.

SiteWall must not depend on Vite or another particular build system.

TypeScript may be required.

---

# 2. Package Installation

SiteWall is distributed as an npm package installable into an existing React application.

Installation/setup must integrate SiteWall into the host application and create a SiteWall page accessible through an application route, conventionally:

`/sitewall`

After installation and route analysis, running the host application and visiting `/sitewall` must be sufficient to enter SiteWall.

The integration must be clearly isolated from normal application functionality and capable of being disabled or excluded from production.

SiteWall must not require the host application to adopt a particular:

- build system;
- visual framework;
- router;
- state-management library.

---

# 3. Route Analysis

SiteWall uses a generated route manifest:

`page-routes.json`

Route discovery is performed as a separate Codex analysis step after package installation.

Codex analyzes the host application and derives the set of actual user-accessible pages SiteWall should represent.

Analysis must account for:

- static routes;
- parameterized routes;
- nested routes;
- optional parameters;
- query parameters when they materially change page identity;
- routes whose parameters originate from application data;
- authentication-related pages;
- redirects;
- application entry points;
- routes defined outside conventional React router configuration;
- other application-specific routing behavior relevant to SiteWall.

Parameterized routes must be resolved into useful concrete pages where possible.

For example:

`/watches/:model`

might produce:

`/watches/model-1`  
`/watches/model-2`

Codex may inspect source code, configuration, static content, data sources, APIs, or other project resources necessary to derive useful concrete routes.

---

# 4. Route Manifest

`page-routes.json` is the durable interface between application analysis and SiteWall.

It must contain enough information to identify and navigate the pages represented by SiteWall.

It must support:

- human-readable page identity;
- concrete route;
- originating route pattern where applicable;
- route parameters where applicable;
- useful grouping or hierarchy;
- default inclusion/exclusion;
- metadata needed for unusual routes or page states.

The manifest must remain human-readable and manually editable.

The exact schema is a package design decision.

---

# 5. SiteWall Workspace

The `/sitewall` page presents application pages on a shared spatial workspace.

The workspace supports:

- zooming;
- panning;
- scrolling where appropriate;
- changing composition;
- changing representation;
- selecting visible routes;
- focusing pages;
- navigating;
- interacting with the application;
- editing application styles.

The workspace must support movement between a whole-application overview and detailed interaction with individual pages without losing the current SiteWall session.

---

# 6. Workspace Structure

SiteWall contains three major workspace regions:

- a collapsible left control panel;
- the central SiteWall canvas;
- a collapsible right stylesheet panel.

Both side panels must be collapsible so that maximum space can be devoted to the SiteWall canvas when desired.

The exact visual design and interaction model are intentionally unspecified.

---

# 7. Route Selection

The left control area provides access to the routes described by `page-routes.json`.

Routes can be shown or hidden individually.

The interface must remain usable for applications containing many routes.

Changing route visibility changes the current SiteWall composition without modifying the underlying route manifest.

The left area also provides access to SiteWall settings and controls.

---

# 8. Page Panels

Each visible application page is represented by a panel.

Every persistent panel has an assigned route.

The identity of the panel is its assigned page, not whatever URL the application may temporarily navigate to while being used.

SiteWall must maintain the invariant:

> A persistent panel represents its assigned route.

Application navigation must therefore never permanently replace one page panel with another or leave duplicate panels representing the same destination merely because navigation occurred.

---

# 9. Focus

SiteWall maintains a single current interaction focus.

The focused panel represents the user's current location within the application.

It must be visually obvious which panel has focus.

Non-focused panels must:

- be visually distinguishable from the focused panel;
- be protected from accidental interaction with their application content.

Selecting a non-focused panel must allow focus to transfer to it without accidentally activating whatever application control happens to be beneath the selection action.

The visual treatment of focus and inactive panels is a Creative design decision.

---

# 10. Navigation and Focus Transfer

Navigation inside the focused application panel represents movement through the application rather than reassignment of the panel.

If panel A navigates to route B and B already has a dedicated panel:

1. SiteWall recognizes the destination;
2. focus transfers to B's panel;
3. B becomes the current application location;
4. A's panel returns to its assigned route;
5. both persistent panels remain represented.

For example:

`Home → Watches`

must result in:

`Home panel = Home`  
`Watches panel = Watches`  
`Focus = Watches`

It must not result in two Watches panels and the disappearance of Home.

This behavior applies to:

- links;
- programmatic navigation;
- redirects;
- login flows;
- logout flows;
- purchase completion;
- authentication callbacks;
- application-driven navigation;
- other route transitions.

---

# 11. Current Route and Address Control

SiteWall must continuously expose the current focused route.

A persistent address/navigation control displays that route and also allows direct navigation.

This provides both:

- visual confirmation of the user's current location;
- a direct means of navigating the application.

Navigation initiated through this control follows the same route ownership, panel restoration, and focus-transfer rules as navigation initiated inside application pages.

---

# 12. Shared Application State

SiteWall must preserve shared application state across panels wherever that state would logically persist during normal use of the application.

Examples include:

- authentication;
- logged-in user;
- account state;
- shopping cart;
- persisted preferences;
- purchase state;
- application data mutations;
- other shared application state.

Logging in through one panel, for example, must allow other relevant panels to represent the authenticated state.

Completing an application action in one panel must not create misleading isolated versions of the application elsewhere on the wall.

Page-local presentation state may remain independent where appropriate.

---

# 13. Layout Modes

SiteWall supports at least two major representations.

## 13.1 Full-Page Overview

Pages are presented as complete-page visual compositions aligned from their tops.

This mode is optimized for holistic analysis of:

- visual hierarchy;
- page rhythm;
- typography;
- spacing;
- density;
- repeated structures;
- consistency;
- content progression;
- overall design language;
- relationships between pages.

## 13.2 Device / Viewport Layout

Pages are presented as tiled browser/device viewports.

This mode is optimized for:

- responsive behavior;
- interaction;
- navigation;
- functional testing;
- scroll behavior;
- mobile design;
- viewport-dependent experiences.

Changing representations must not unnecessarily destroy the current SiteWall session or application state.

---

# 14. Device Representation

SiteWall supports common representative viewport/device presets.

Device representations must reproduce the effective CSS viewport experienced by the application rather than simply using physical display pixel resolution.

The available choices should cover useful contemporary:

- phone;
- tablet;
- laptop;
- desktop

viewport sizes.

Custom viewport dimensions must also be possible.

SiteWall's own zoom level must not change the viewport dimensions perceived by the application.

---

# 15. Scroll-Dependent Behavior

SiteWall must preserve meaningful viewport and scrolling behavior.

This includes:

- above/below-the-fold composition;
- sticky positioning;
- viewport-relative sizing;
- intersection-triggered behavior;
- lazy loading;
- scroll-triggered transitions;
- scroll-driven animation;
- progressive experiences;
- dynamically activated sections;
- other behavior dependent on viewport dimensions or scroll progress.

A holistic full-page representation must not misrepresent such pages merely by giving the application an artificially tall viewport.

SiteWall must preserve the semantic distinction between:

**document height**

and

**viewport height**.

The solution is intentionally left to Creative and engineering.

---

# 16. Left Control Panel

SiteWall provides a collapsible left-side control surface.

It must provide access to the major dimensions of SiteWall state, including:

- available routes;
- visible routes;
- focused route;
- layout;
- viewport/device;
- zoom;
- composition;
- navigation;
- relevant visualization and workspace settings.

Controls may be organized into collapsible sections.

The entire panel must be collapsible into a substantially smaller form so that it does not unnecessarily consume canvas space.

The exact organization and interaction design are intentionally unspecified.

---

# 17. Right Stylesheet Panel

SiteWall provides a collapsible right-side workspace dedicated to application stylesheets.

The panel allows relevant editable stylesheets from the host application to be opened and edited while SiteWall is running.

Required capabilities include:

- discovering or presenting editable application stylesheets;
- selecting a stylesheet;
- viewing its contents;
- editing it;
- saving changes automatically;
- causing saved changes to be reflected by the running application;
- allowing the resulting changes to be evaluated immediately across the SiteWall.

The intended workflow is:

`inspect application → edit styles → see effect across pages`

without leaving SiteWall.

Where the host development environment supports hot reloading, stylesheet edits must participate in that workflow so that visible pages update without requiring manual rebuild/restart cycles.

The stylesheet workspace must be suitable for both human and agent use.

The exact editor, file-access mechanism, save mechanism, hot-reload integration, and implementation architecture are intentionally unspecified.

---

# 18. Human Interaction

A human operator must be able to use SiteWall both as a spatial overview and as an interactive application environment.

The operator must be able to:

- inspect the application holistically;
- focus an individual page;
- interact with it normally;
- navigate between pages;
- scroll;
- enter data;
- exercise workflows;
- change viewport/device;
- change SiteWall composition;
- edit styles;
- immediately inspect the consequences across the application;
- return to a holistic view without losing the current application session.

---

# 19. Agent Interaction API

SiteWall provides a first-class API intended for software agents.

Every meaningful SiteWall capability available to a human should have an agent-accessible equivalent where practical.

Agents must be able to:

- inspect SiteWall state;
- inspect routes;
- inspect visible routes;
- change route visibility;
- change layout;
- change viewport/device;
- control zoom;
- control pan;
- change composition;
- focus pages;
- navigate;
- scroll;
- interact with application controls;
- enter text;
- activate links and buttons;
- exercise user workflows;
- inspect individual pages;
- inspect visible application state;
- access stylesheet functionality;
- edit styles;
- observe the resulting changes.

The API must provide sufficiently deterministic controls that agents are not forced to approximate SiteWall operations using screen coordinates where semantic control is possible.

---

# 20. Agent Observation

Agents must be able to determine what occurred as a consequence of an action.

Observable information should include, where applicable:

- focused route;
- navigation;
- redirects;
- focus transfers;
- restoration of assigned panel routes;
- application state changes;
- visible page state;
- stylesheet changes;
- errors;
- failed interactions;
- other information required to determine whether an intended action succeeded.

SiteWall must support iterative:

`observe → reason → act → observe`

workflows.

---

# 21. Shared Human/Agent Session

Humans and agents operate on the same SiteWall state.

An agent may configure, style, inspect, or navigate SiteWall and then hand control to a human.

A human may manipulate the application or SiteWall and then allow an agent to continue from that state.

SiteWall is therefore a shared visual development environment rather than separate human and automation environments.

---

# 22. Creative-Agent Use

SiteWall must be suitable as a working environment for Creative agents performing holistic application analysis and design.

Creative agents must be able to:

- see multiple pages together;
- compare them visually;
- understand the application's overall design language;
- inspect individual pages;
- compare responsive presentations;
- manipulate the wall;
- navigate through the application;
- perform realistic user journeys;
- inspect resulting states;
- identify cross-page inconsistencies;
- edit styling;
- evaluate styling changes across many pages simultaneously;
- evaluate changes within the context of the complete application rather than isolated screenshots.

The application itself becomes a live, manipulable Creative artifact.

---

# 23. Framework Requirements

SiteWall targets React applications.

Requirements:

- React;
- TypeScript support, which may be required;
- no dependency on Vite;
- compatibility with common React build and deployment environments;
- no required host styling framework;
- no required host state-management library;
- minimal assumptions about the application's router.

Support for particular React frameworks and routers may vary where their architectures impose unavoidable constraints.

---

# 24. Development Scope and Security

SiteWall is a development, design, analysis, and testing facility.

The package must provide a clear means of preventing SiteWall and its development capabilities from becoming publicly accessible in production when the host project requires this.

This is especially important because SiteWall may expose:

- application internals;
- route information;
- development controls;
- source stylesheets;
- editing capabilities;
- agent controls.

---

# 25. Installation Deliverables

After package setup and the Codex route-analysis step, the host project contains everything required to use SiteWall, including:

- SiteWall npm dependency;
- SiteWall application integration;
- `/sitewall` route;
- `page-routes.json`;
- any minimal project-local configuration required by SiteWall.

Running the host application and visiting `/sitewall` must enter the SiteWall environment.

---

# 26. Prior Art and Design References

Creative and engineering should study existing multi-viewport development tools for prior art and solutions to already-understood usability problems.

Primary references:

- Polypane — https://polypane.app/
- Sizzy — https://sizzy.co/
- Responsively App — https://responsively.app/
- Responsively App source — https://github.com/responsively-org/responsively-app

These products may provide useful inspiration for problems such as:

- managing many simultaneous viewports;
- device selection;
- viewport presentation;
- synchronized interaction;
- zoom and layout controls;
- pane management;
- navigation controls;
- responsive testing workflows;
- usability at high pane counts;
- agent/browser automation;
- agent-facing interaction models.

Responsively App's agent/MCP capabilities are particularly relevant prior art for SiteWall's agent interaction requirements.

These references are provided to avoid unnecessarily rediscovering solved interaction and usability patterns.

They are **not** specifications for SiteWall.

Creative must not allow the design to drift into simply reproducing an existing responsive-testing browser.

SiteWall's defining model remains:

> **many application routes × shared application state × persistent route panels × moving interaction focus**

In particular, SiteWall is intended to represent the application itself as a persistent spatial system.

Its core concepts—including stable route ownership, automatic restoration of panels after navigation, focus transfer between route panels, holistic application representation, live styling, and agent manipulation of the complete application—must be preserved regardless of patterns borrowed from prior art.

---

# 27. Non-Prescriptive Requirements

This specification intentionally does not prescribe:

- iframe usage;
- router integration technique;
- routing library;
- zoom/pan library;
- state synchronization architecture;
- DOM communication mechanism;
- agent transport protocol;
- page capture or rendering strategy;
- scroll-state representation technique;
- stylesheet editor;
- filesystem integration;
- hot-reload implementation;
- component architecture;
- styling;
- visual design;
- specific control layouts;
- specific npm dependencies.

Those decisions belong to the Creative and engineering process.

The required outcome is the behavior, capabilities, and conceptual model described by this specification.