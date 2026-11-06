@echo off
title Update Student Cache
echo =========================================
echo  Starting Student Cache Update
echo =========================================
echo.

:: Переход в директорию, где находится скрипт
cd /d "%~dp0"

:: Проверка наличия виртуального окружения и запуск скрипта
if exist "backend\venv\Scripts\python.exe" (
    echo Using virtual environment...
    backend\venv\Scripts\python.exe backend\update_cache.py
) else (
    echo Virtual environment not found. Using global Python...
    python backend\update_cache.py
)

echo.
echo =========================================
echo  Update process finished.
echo =========================================
pause