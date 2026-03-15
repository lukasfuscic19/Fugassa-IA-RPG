WIZARD PHASE 1 PATCH

This patch adds the first phase of an AI-assisted New Game Wizard.

What it does:
- New campaigns start with setupComplete = false
- Each save gets setup_draft.json
- A setup chat becomes active before normal play
- AI helps define:
  - world concept
  - character concept
  - starting situation
- Setup messages are stored inside setup_draft.json
- If the player types:
  begin
  start game
  looks good
  finalize
  let's begin
  then the wizard finalizes Phase 1 and generates an opening scene

FILES INCLUDED
- saveManager.js
- server.js
- web/index.html
- web/style.css
- web/app.js

INSTALL
Copy these files over the existing project files and replace the old ones.
Then run start.bat again.
