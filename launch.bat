@echo off
title Public Schedule Launcher
color 0A

echo ===================================================
echo   Public Schedule - Automatic Launcher
echo ===================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please download from https://nodejs.org/
    pause
    exit
)

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed!
    echo Please download from https://www.python.org/downloads/
    pause
    exit
)

echo [OK] Node.js and Python are installed.
echo.

echo [INFO] Installing backend dependencies globally...
:: Устанавливаем пакеты в системный Python (обходим venv)
python -m pip install fastapi uvicorn requests urllib3
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Python dependencies.
    echo Please make sure you have internet connection and Python is installed correctly.
    pause
    exit
)

cd frontend
if not exist "node_modules" (
    echo [INFO] Installing frontend dependencies...
    call npm install
)
cd ..

echo.
echo [INFO] Starting servers...
start "Schedule Backend" cmd /k "cd backend && python -m uvicorn main:app --reload --port 8000"
start "Schedule Frontend" cmd /k "cd frontend && npm run dev"

timeout /t 5 /nobreak >nul
start http://localhost:5173

echo.
echo Done! Closing launcher in 3 seconds...
timeout /t 3 >nul