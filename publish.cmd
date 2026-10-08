@echo off
setlocal

call npm version patch || exit /b 1
call npm publish --access public || exit /b 1

echo Published successfully.