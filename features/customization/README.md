# Customization temporarily paused

The cake and brownie cards are removed from Home. Their editor markup, JavaScript and cake CSS live in this folder and are not fetched on normal app startup. Three.js and customization pricing/configuration are no longer requested on startup.

Existing order records and database tables are untouched. Opening an existing custom order to edit it loads the editor on demand through loadLegacyCustomization() in index.html. Upload pages.html, studio.js and studio.css alongside index.html so those older orders can still be edited.

Preserved source:
- home-cards.html: original two Home cards
- pages.html: both editor pages and the flavour sheet
- studio.js: extracted editor logic, preview and pricing functions
- studio.css: cake styling
- index-before-disable.html.txt: exact pre-change landing-page snapshot (reference only; do not serve as the app)

To restore the feature later, add the saved cards at their original position before HOME HERO KEYFRAMES in index.html. Change their click handlers to await loadLegacyCustomization() before showPage('cake-studio') or showPage('custom-order'). This keeps the feature available on demand without restoring heavy startup loads. Do not overwrite future app changes with the old snapshot.
