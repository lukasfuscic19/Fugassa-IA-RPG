AI ↔ DATABASE INTEGRATION PATCH (PHASE 1: READ LAYER)

This package adds:
- dbEngine.js: a safe database read layer
- server integration note showing exactly how to wire it into server.js

What Phase 1 gives you:
- AI can read current player data
- AI can read current location
- AI can read present NPCs in the location
- AI can read player inventory
- AI can read active quests
- AI can read visited locations
- AI can read available exits / connections
- AI can read location flags

This is the correct first step before write-back.

INSTALL
1. Put dbEngine.js into your project root
2. Update server.js using SERVER_INTEGRATION_PATCH_NOTE.txt
3. Restart start.bat

NEXT STEP AFTER THIS
Phase 2 should add controlled WRITE-BACK for:
- location changes
- item gain/loss
- quest progress
- first-time NPC encounters
