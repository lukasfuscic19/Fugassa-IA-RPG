WIZARD FINALIZE CONFIRMATION + EDIT LAST PLAYER MESSAGE PATCH

This combined patch adds:
1. Wizard finalization confirmation logic
2. Edit last player message support for gameplay
3. Edit last wizard message support for setup wizard

What changes:

WIZARD FINALIZE CONFIRMATION
- setup can no longer finalize automatically from vague readiness
- if AI detects probable finalization intent, it asks directly
- explicit confirmation is required before finalizing
- overview / summary requests do NOT finalize setup
- "Finalize setup" button now asks first before actual finalization

EDIT LAST PLAYER MESSAGE
- gameplay: edit the latest player action and regenerate from the same pre-turn snapshot
- wizard: edit the latest player wizard message and regenerate the following AI reply
- both systems only allow editing of the latest relevant player input

FILES INCLUDED
- server.js
- web/app.js
- web/index.html
- README_WIZARD_CONFIRM_AND_EDIT_PATCH.txt

INSTALL
1. Replace server.js
2. Replace web/app.js
3. Replace web/index.html
4. Restart start.bat
