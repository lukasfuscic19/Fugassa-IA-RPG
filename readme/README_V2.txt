Included files:
- server.js: setup preview/finalize fixes, starting time extraction, campaign profile inference, V2 prompt integration
- schema.sql: adds campaign_settings and story_arcs tables
- dbWriteEngine.js: unchanged from your provided version (already supports time advance and structured world changes)
- storyArcEngine.js: new V2 architecture module for campaign settings and story arc management

Notes:
- Wizard now infers campaign length, pacing, style, complexity, and pacing governor from player preferences.
- Wizard overview includes starting time.
- Finalize writes calendar/time, campaign settings, initial arcs, PC, location, quest, event, inventory.
- Turn prompt now receives campaign settings and relevant story arcs.
- Turn processing heuristically advances story arcs and updates global threat level.
