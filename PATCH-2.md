# PATCH 2 - Usability

Look at screenshot at /references/patch-2.jpg

- Map mouse wheel click to 1% of zoom increment/decrement. 

- Persist all settings and state.

- When I click on an out of focus panel to activate it, I can't scroll it with the mouse wheel.  Only when I touch and move its scroll bar does it become wheel scrollable.  Interestingly, pages that get activated by a button click on another page, do get scrolled immediately.

- When selection mode is on, DO NOT overlay the live panels with anything, currently there is a dim greenish overlay. 

- Change the mouse pointer to Arrow (standard pointer) when in selection mode, not cross hairs.

- Currently, panning only works by clicking and dragging the background.  Clicking and dragging over a panel does not work.  Make SHIFT-DRAG work over everything, background and panels.  Also change cursor to 'grab' when SHIFT is held.  Whenever dragging, cursor should be 'grabbing'.

- When panning, the UI becomes laggy.  It should be smooth.  Nothing should disrupt the ui update thread.  All UI updates should be handled asyncronously to maintain responsiveness.

- When I hold CTRL, or zooming in, cursor is zoom-in.  If I am zooming out, cursor should be zoom-out.  When CTRL is released, cursor is unset.

- Some style editors contain unformatted styles that don't wrap, causing horizontal scroll bars.
All styles should be formatted with one property per line.
Style editors should not have scroll bars.  Their width should fill available panel width, and their height should accomodate their content.  Only the panel should have a single scroll bar.

- The current color scheme for styles does not work well with the background color of the panel.  Numeric values aren't readable at all.  It need to be more contrasting and readable.  Change the overall color from this blue to something more neutral and darker.  React's dark theme background color is good.  Or even vs code.  

- Sometimes there are errors that say:  Error: Cannot safely map this runtime rule to its source.

- Make style panel resizable and persist its size.


