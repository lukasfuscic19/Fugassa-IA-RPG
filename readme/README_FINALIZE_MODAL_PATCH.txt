FINALIZE MODAL PATCH

This patch adds a proper setup finalization modal with:
- Yes, finalize
- Wait, show overview
- Cancel

Behavior:
- clicking Finalize setup opens the modal
- Yes finalizes setup and begins the game
- Wait asks AI for an overview and keeps the wizard open
- Cancel closes the modal and does nothing

FILES INCLUDED
- web/index.html
- web/app.js
- web/style.css
- README_FINALIZE_MODAL_PATCH.txt

INSTALL
1. Replace web/index.html
2. Replace web/app.js
3. Add the CSS from web/style.css into your full style.css, or replace if you prefer and know what you're doing
4. Hard refresh the browser
