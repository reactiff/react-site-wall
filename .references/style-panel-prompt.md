We are still missing a page-styles.json, which should sit right beside page-routes.json.  This is the list of style.css files to load that can be searched and edited in the right panel.

(Please see screenshot /.references/style-panel-comp.jpg comparing the current site-wall panel on the left to Chromium devtools style editor)

The panel is still using a single codemirror editor.  I need each css class from style files to be shown individually, in order of specificity, the way devtools does it.  Classes that do not apply to context of the page or selection should not be shown.  

Filter box at the top should also limit classes shown.

Each class in separate codemirror editor.  No line numbers.  Filename displayed in the top right cornder of each class panel.

Also, remove padding and margins.  Make everything pack tightly, just like in devtools.  No need for APPLICATION STYLES caption on top.

Remove this paragraph "Stylesheets in document order. Matched declarations use..."

Remove Reopen from disk button.  T

Remove Format CSS buton




