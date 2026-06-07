@echo off
chcp 65001 >nul
title 檀枫 AI 工具箱 - 服务器

cd /d "C:\Users\70719\Desktop\agent-market"

:loop
echo [%date% %time%] 启动服务器...
python server.py
echo [%date% %time%] 服务器已停止，3秒后自动重启...
timeout /t 3 /nobreak >nul
goto loop
