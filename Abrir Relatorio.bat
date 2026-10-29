@echo off
chcp 65001 >nul
title Relatorio de transferencias (teste local)
cd /d "%~dp0"
rem Uso local, so neste computador.
start "" http://localhost:3008/
python app.py
if errorlevel 1 (
  echo.
  echo O relatorio foi encerrado com erro. Veja a mensagem acima.
  pause
)
