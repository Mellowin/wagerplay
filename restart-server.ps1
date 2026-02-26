#!/usr/bin/env powershell
# WagerPlay Backend - Restart Script
# Usage: .\restart-server.ps1

Write-Host "=== Stopping services ===" -ForegroundColor Yellow
taskkill /F /IM node.exe 2>$null
taskkill /F /IM ngrok.exe 2>$null
docker-compose down

Write-Host "=== Building ===" -ForegroundColor Green
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "=== Starting services ===" -ForegroundColor Green
docker-compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker failed!" -ForegroundColor Red
    exit 1
}

Write-Host "=== Starting server ===" -ForegroundColor Cyan
npm run start:prod
