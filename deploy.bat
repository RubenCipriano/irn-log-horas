@echo off
REM Deploy script for website-log-horas
REM Stops old container, rebuilds from scratch, and starts fresh

setlocal enabledelayedexpansion

echo.
echo ================================
echo Website Log Horas - Deploy
echo ================================
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo Docker is not installed. Please install Docker Desktop first.
    pause
    exit /b 1
)

echo Docker is installed:
docker --version
echo.

REM Stop and remove old container + image
echo Stopping and removing old container...
docker compose down --rmi local --remove-orphans 2>nul
echo.

REM Build fresh (no cache)
echo Building Docker image (no cache)...
docker compose build --no-cache
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)

echo.
echo Starting services...
docker compose up -d
if errorlevel 1 (
    echo Failed to start services!
    pause
    exit /b 1
)

echo.
echo Waiting for application to be ready...
timeout /t 5 /nobreak

REM Check if the container is running
docker compose ps | findstr /I "website-log-horas" >nul
if errorlevel 1 (
    echo Application failed to start. Check logs: docker compose logs
    pause
    exit /b 1
)

echo.
echo Deployment successful!
echo.
echo   URL:       http://localhost:3700
echo   Container: website-log-horas
echo.
echo Commands:
echo   Logs:    docker compose logs -f
echo   Stop:    docker compose down
echo   Status:  docker compose ps
echo.
pause
