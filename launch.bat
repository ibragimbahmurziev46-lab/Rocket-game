@echo off
title Public Schedule Launcher
echo Starting Public Schedule project...

:: Запуск бэкенда в отдельном окне
echo [1/3] Starting Backend Server...
start "Schedule Backend" cmd /k "cd backend && venv\Scripts\activate.bat && python -m uvicorn main:app --reload --port 8000"

:: Запуск фронтенда в отдельном окне
echo [2/3] Starting Frontend Server...
start "Schedule Frontend" cmd /k "cd frontend && npm run dev"

:: Ожидание инициализации Vite (5 секунд)
echo [3/3] Waiting for servers to initialize...
timeout /t 5 /nobreak >nul

:: Открытие браузера по умолчанию
echo Opening browser...
start http://localhost:5173

echo Done. You can close this window.
timeout /t 3 >nul
exit