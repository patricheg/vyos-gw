@echo off
title VyOS Web Gateway
cd /d C:\propjects\vyos-gw

echo Starting backend (http://localhost:8001)...
start "VyOS-GW Backend" cmd /k "cd /d C:\propjects\vyos-gw\backend && venv\Scripts\python.exe run_server.py"

echo Starting frontend (http://localhost:7100)...
start "VyOS-GW Frontend" cmd /k "cd /d C:\propjects\vyos-gw\frontend && npm run dev"

timeout /t 5 /nobreak >nul
start "" http://localhost:7100/

echo.
echo Backend:  http://localhost:8001
echo Frontend: http://localhost:7100
echo Close the two opened windows to stop the servers.
pause
