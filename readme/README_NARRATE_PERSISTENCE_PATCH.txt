PATCH CONTENTS

This patch adds persistent Narrate mode per campaign save.

What changes:
- narrateMode is saved in each save's config.json
- switching campaigns restores the correct Narrate ON/OFF state
- the backend now reads narrateMode from the active save
- the frontend toggle updates the saved setting immediately

FILES INCLUDED
- saveManager.js
- server.js
- web/app.js

INSTALL
Copy these files over the existing project files and replace the old ones.
Then run start.bat again.
