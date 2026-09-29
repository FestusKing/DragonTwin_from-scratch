#!/bin/sh
# Vergleichstest: Flugphysik Browser-Spiel (JS) gegen C#-Version (für s&box).
# Braucht: node und das .NET-SDK (dotnet, Version 8 oder neuer). Aufruf: sh sbox/Tests/run_all.sh
# Nutzt die Test-Flüge aus unreal/Tests/ (gleiche Eingaben wie der Unreal-Test).
set -e
cd "$(dirname "$0")"
HERE="$(pwd)"
UT="$HERE/../../unreal/Tests"
mkdir -p "$UT/out"
# 1) Browser-Spiel (JS) rechnet die Test-Flüge und schreibt die Eingaben (.env/.in) + Ergebnisse (.js.txt)
if [ "$1" != "--ohne-js" ]; then
	(cd "$UT" && node --import ./js_stubs/register.mjs run_js.mjs)
fi
# 2) C#-Version bauen (nur die Flight-Dateien, ohne s&box) und dieselben Flüge rechnen lassen
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
dotnet build FlightTest/FlightTest.csproj -c Release -o "$HERE/out" --nologo -v quiet
NAMES=$(cd "$UT" && node -e "import('./scenarios.mjs').then((m) => console.log(m.SCENARIOS.map((s) => s.name).join(' ')))")
dotnet "$HERE/out/FlightTest.dll" "$UT/out/" $NAMES
# 3) Vergleichen
(cd "$UT" && node compare.mjs cs)
# 4) s&box-Teile (DragonController.cs, RaceComponent.cs) gegen eine kleine Nachbildung von s&box kompilieren
#    (findet Tipp- und Typ-Fehler; ob s&box die Namen wirklich so hat, zeigt erst s&box selbst)
dotnet build ControllerCheck/ControllerCheck.csproj -c Release -o "$HERE/out/check" --nologo -v quiet
echo "s&box-Teile (DragonController.cs, RaceComponent.cs): kompilieren gegen die s&box-Nachbildung ✔"
