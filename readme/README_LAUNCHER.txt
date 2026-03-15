Professional launcher bundle for the AI RPG backend.

Use:
- launch_ai_rpg.bat        -> start LM Studio server if needed, ensure model/context, start backend hidden, open WebUI
- stop_ai_rpg.bat          -> stop backend only
- stop_all_ai_rpg.bat      -> stop backend and LM Studio API listener
- status_ai_rpg.bat        -> show launcher/backend/API status

Important:
- The launcher expects `lms` to be available in PATH.
- The launcher uses model: qwen3.5-9b-uncensored-hauhaucs-aggressive
- Target context length: 16000
- Logs are written to: startup_logs/
- Backend stdout/stderr are redirected into startup_logs/

Recommended old files to remove after switching:
- start.bat
- start_backend.vbs
- start_backend.ps1
- stop.bat
- stop_backend.ps1
- status.bat
- status_backend.ps1
