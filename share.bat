@echo off
title Threshold share tunnel
cd /d "%~dp0"
:: Shares ONLY the game (read-only Watch links). TrueForge stays on localhost.
node scripts\tunnel.mjs
pause
