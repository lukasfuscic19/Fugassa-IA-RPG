Adaptive Wizard + v2 architecture bundle

Files to overwrite:
- server.js
- schema.sql

Files to add:
- engine/wizardEngine.js
- engine/worldConfigEngine.js
- engine/promptEngine.js
- engine/storyArcEngine.js

Optional:
- dbWriteEngine.js is included only as a copy of your current file. You do not need to replace it unless you want all files from one bundle.

What this bundle does:
1. Adaptive setup wizard
   - The setup wizard now asks follow-up questions based on player intent.
   - It can infer campaign length, pacing, style, complexity, and narrative focus.
2. Setup preview improvements
   - Overview includes starting time and structured setup data.
3. Campaign profile persistence
   - Finalize writes campaign settings to DB.
4. Story arc foundation
   - Finalize creates initial story arcs.
   - Normal turn prompts receive campaign settings and relevant arcs.

Install steps:
1. Back up your current project files.
2. Overwrite server.js with the bundled server.js.
3. Overwrite schema.sql with the bundled schema.sql.
4. Create a new folder in project root named 'engine' if it does not exist.
5. Put the four engine/*.js files into that folder.
6. Restart the server.
7. Create a NEW save for testing. Existing saves do not automatically migrate new tables.

What to delete:
- Do not delete your old files inside the project if they are still in use.
- You can delete old experimental bundle files you downloaded earlier from this chat.
- Do NOT delete dbWriteEngine.js unless you are replacing it with the bundled copy.

Recommended test:
1. Create a new save.
2. Ask for choices in the setup wizard.
3. Ask for overview before finalize.
4. Finalize.
5. Test:
   - show my inventory
   - where am i
   - ask about the campaign style
