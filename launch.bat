@echo off
title Public Schedule Launcher
color 0A

echo ===================================================
echo   Public Schedule - Automatic Launcher
echo ===================================================
echo.

:: Проверка структуры папок
if not exist "backend\python_embed\python.exe" (
    echo [ERROR] Cannot find backend\python_embed\python.exe
    echo Make sure the python_embed folder is inside the backend folder.
    pause
    exit
)
echo [OK] Embedded Python found.

if not exist "frontend\node_modules" (
    echo [ERROR] Cannot find frontend\node_modules
    echo Make sure you have installed frontend dependencies.
    pause
    exit
)
echo [OK] Frontend dependencies found.
echo.

:: Запуск Бэкенда
echo [1/2] Starting Backend Server...
start "Schedule Backend" cmd /k "cd backend && python_embed\python.exe -m uvicorn main:app --reload --port 8000"

:: Запуск Фронтенда
echo [2/2] Starting Frontend Server...
start "Schedule Frontend" cmd /k "cd frontend && npm run dev"

:: Ожидание и открытие браузера
echo.
echo [INFO] Waiting 5 seconds for servers to initialize...
timeout /t 5 /nobreak >nul

echo [INFO] Opening browser...
start http://localhost:5173

echo.
echo ===================================================
echo   Done! You can close this window.
echo ===================================================
timeout /t 3 >nul