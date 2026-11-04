@echo off
chcp 65001 >nul
title Запуск Public Schedule
echo ===================================================
echo   Подготовка к запуску проекта Public Schedule
echo ===================================================

:: --- 1. Проверка и установка зависимостей Бэкенда (Python) ---
echo [1/3] Проверка зависимостей бэкенда...
if not exist "backend\venv\Scripts\python.exe" (
    echo   - Виртуальное окружение не найдено. Создаю...
    python -m venv backend\venv
)

:: Проверяем наличие fastapi и requests в venv. Если нет - устанавливаем.
backend\venv\Scripts\python.exe -c "import fastapi, requests" >nul 2>&1
if %errorlevel% neq 0 (
    echo   - Зависимости Python не найдены или устарели. Устанавливаю...
    backend\venv\Scripts\python.exe -m pip install fastapi uvicorn requests
)

:: --- 2. Проверка и установка зависимостей Фронтенда (Node.js) ---
echo [2/3] Проверка зависимостей фронтенда...
if not exist "frontend\node_modules" (
    echo   - Папка node_modules не найдена. Устанавливаю зависимости...
    cd frontend
    call npm install
    cd ..
)

:: --- 3. Запуск серверов ---
echo [3/3] Запуск серверов...
echo.
echo   - Бэкенд будет доступен по адресу: http://localhost:8000
echo   - Фронтенд будет доступен по адресу: http://localhost:5173
echo.
echo Не закрывайте открывшиеся окна терминалов, пока работаете с проектом.
echo.

start "Public Schedule - Backend" cmd /k "cd backend && venv\Scripts\activate.bat && python -m uvicorn main:app --reload --port 8000"
start "Public Schedule - Frontend" cmd /k "cd frontend && npm run dev"

echo Готово! Окна серверов открыты.
timeout /t 3 >nulw