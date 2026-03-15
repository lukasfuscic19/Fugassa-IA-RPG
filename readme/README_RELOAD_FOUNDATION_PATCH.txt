RELOAD LAST MESSAGE FOUNDATION PATCH

This patch adds the foundation for reloading the latest AI reply.

What it does:
- creates and bootstraps turn_history
- stores each active player turn with:
  - player_text
  - ai_text
  - prompt_snapshot
  - ingame_time
- links scene_summaries and event_log to turn_id
- marks old turns inactive instead of deleting them
- adds backend endpoint:
  POST /api/reload-last-turn
- adds frontend button:
  Reload last reply

How reload works:
- only the latest active turn can be reloaded
- the last AI response is invalidated
- related scene summary and event log rows are invalidated
- a fresh alternative response is generated from the saved pre-turn prompt snapshot
- the new reply becomes the new active turn

FILES INCLUDED
- saveManager.js
- server.js
- web/index.html
- web/app.js
- README_RELOAD_FOUNDATION_PATCH.txt

INSTALL
1. Replace saveManager.js
2. Replace server.js
3. Replace web/index.html
4. Replace web/app.js
5. Restart start.bat
