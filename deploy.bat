@echo off
REM Deploy script for website-log-horas
REM This script deploys the Next.js application using Docker Compose

setlocal enabledelayedexpansion

echo.
echo ================================
echo 🚀 Website Log Horas - Deploy
echo ================================
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker is not installed. Please install Docker Desktop first.
    echo    Download from: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

REM Check if Docker Compose is installed
docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker Compose is not installed or not in PATH.
    echo    Make sure Docker Desktop is installed and running.
    pause
    exit /b 1
)

echo 📋 Docker is installed and ready
docker --version
docker-compose --version
echo.

REM Get the directory of the script
for %%i in ("%~dp0") do set "SCRIPT_DIR=%%~fi"

REM Navigate to the application directory
cd /d "%SCRIPT_DIR%"

echo 📦 Building Docker image...
docker-compose build
if errorlevel 1 (
    echo ❌ Docker build failed!
    pause
    exit /b 1
)

echo.
echo 🔥 Starting services...
docker-compose up -d
if errorlevel 1 (
    echo ❌ Failed to start services!
    pause
    exit /b 1
)

echo.
echo ⏳ Waiting for application to be ready...
timeout /t 5 /nobreak

REM Check if the container is running
docker-compose ps | findstr /I "website-log-horas" >nul
if errorlevel 1 (
    echo ❌ Application failed to start. Check logs with: docker-compose logs
    pause
    exit /b 1
)

echo.
echo ✅ Application is running!
echo.
echo 🎉 Deployment successful!
echo.
echo Application details:
echo   - URL: http://localhost:3700
echo   - Container: website-log-horas
echo.
echo Useful commands:
echo   - View logs:        docker-compose logs -f
echo   - Stop services:    docker-compose down
echo   - Restart services: docker-compose restart
echo   - View status:      docker-compose ps
echo.
pause
