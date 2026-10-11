# Workspace constraints

- The user explicitly requires Vanguard to remain untouched. Do not stop, restart, disable, uninstall, reconfigure, or modify Riot/Vanguard processes, services or drivers. Avoid broad process cleanup commands.
- The user reported a PC crash after earlier graphics testing. Use source inspection and lightweight, sequential CPU-only test fixtures for the current work. Do not run parallel browser/graphics workloads or import the full asset sets for routine checks.
- Every automated browser check must install `scripts/test-pointer-lock.cjs` before navigating to the game. Native pointer locking in automation previously trapped the user's physical mouse.
- Report source/unit verification separately from actual in-game validation. The new co-op mode has not been graphically play-tested since the crash.
