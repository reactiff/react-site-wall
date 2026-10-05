- Set default live panel resolution to safari viewport on iphone 14 pro which is 393x659.

There is a lot of UI freezing going on.

- Make width and height inputs editable and only apply onblur.
- Make styles panel show up only when element or area selection is on.
- Do not parse styles until something is selected.  Do not show styles that arent in any way connected to selected element or its ancestors.
- Make style parsing and rendering asynchronous to ui rendering.   
- Optimize style parsing.  Cache results.  Cache editors.

## Full length rendering

Pages can't be rendered in a very tall viewport as they rely on viewport height, and need a fold.
So we need to stitch together multiple snapshots to get the full page.

- Sitewall api for codex agents needs a new method, captureFullPage(route) which stitches snapshots of viewable area in viewport.  For each consequitive snapshot, the page must be scrolled by the set viewport height.  Keep in mind that the last snapshot will contain the bottom portion of the previous snapshot.

- Whenever api needs to interact or capture the page, make sure it waits for it to load fully, with sometbing like window ready, as some pages load a lot of data and it may take seconds.