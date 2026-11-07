@echo off
title Public Schedule Launcher
setlocal enabledelayedexpansion

echo ===================================================
echo   Public Schedule - Automatic Launcher
echo ===================================================
echo.

:: 1. Проверка наличия Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    pause
    exit /b
)
echo [OK] Node.js is installed.

:: 2. Проверка наличия Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH!
    pause
    exit /b
)
echo [OK] Python is installed.
echo.

:: 3. Проверка бэкенда
echo --- Checking Backend Dependencies ---
cd backend

if not exist "venv" (
    echo [INFO] Virtual environment not found. Creating venv...
    python -m venv venv
    echo [INFO] Installing Python dependencies...
    call venv\Scripts\activate.bat
    pip install fastapi uvicorn requests urllib3
) else (
    echo [OK] Virtual environment found.
)
cd ..
echo.

:: 4. Проверка фронтенда
echo --- Checking Frontend Dependencies ---
cd frontend
if not exist "node_modules" (
    echo [INFO] node_modules not found. Installing frontend dependencies...
    call npm install
) else (
    echo [OK] Frontend dependencies already installed.
)
cd ..
echo.

:: 5. Запуск серверов
echo --- Starting Servers ---
echo [1/2] Starting Backend Server...
start "Schedule Backend" cmd /k "cd backend && venv\Scripts\activate.bat && python -m uvicorn main:app --reload --port 8000"

echo [2/2] Starting Frontend Server...
start "Schedule Frontend" cmd /k "cd frontend && npm run dev"

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
exit