@echo off
title Manager
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org then run this again. & pause & exit /b 1)
if not exist node_modules (
  echo First run: installing, this takes a minute...
  call npm install || (pause & exit /b 1)
)
node scripts\local.mjs
pause
