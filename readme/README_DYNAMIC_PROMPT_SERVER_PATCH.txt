DYNAMIC PROMPT BUILDER + NEW GM GUIDES PATCH

What this patch changes:
- server.js now supports the new guides:
  - gm_action_interpretation.txt
  - gm_world_sanity.txt
- dynamic prompt builder added
- prompt builder now:
  - always loads core/canon guides
  - selectively loads combat / npc / magic / economy / quests / crafting guides
  - treats database / structured world state as canonical truth
  - frames player actions as attempts, not automatic facts

Install:
1. Replace server.js
2. Put the new GM guides into gm_templates/
3. Restart start.bat

Important:
New Game already copies the whole gm_templates folder, so new guide files will propagate automatically.
