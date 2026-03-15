Startup bundle for the AI RPG backend.

Files:
- start.bat
- start_backend.vbs
- start_backend.ps1
- stop.bat
- stop_backend.ps1
- status.bat
- status_backend.ps1

Behavior:
- Starts LM Studio server via `lms server start` if API on :1234 is not responding
- Loads model `qwen3.5-9b-uncensored-hauhaucs-aggressive` with context length 16000
- Stops old backend on port 3000
- Starts `node server.js` hidden
- Opens http://localhost:3000
- Writes logs into `startup_logs/`
