@echo off
rem Startet BraccioSim ueber einen lokalen Webserver und oeffnet ihn im Browser (Windows-Gegenstueck zu start.command).
cd /d "%~dp0"
set PORT=8000
set PY=python
where python >nul 2>nul || set PY=py
start "" cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:%PORT%/index.html"
echo BraccioSim laeuft auf http://localhost:%PORT%  -  Beenden mit Strg+C oder Fenster schliessen
%PY% -m http.server %PORT% --directory "%CD%"
pause
