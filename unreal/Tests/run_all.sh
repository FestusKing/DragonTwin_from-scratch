#!/bin/sh
# Vergleichstest: Flugphysik Browser-Spiel (JS) gegen C++-Version (für Unreal).
# Braucht: node, g++ (oder clang++). Aufruf: sh unreal/Tests/run_all.sh
set -e
cd "$(dirname "$0")"
mkdir -p out
CXX="${CXX:-g++}"
# 1) Umrechnung Unreal <-> Physik-Raum
"$CXX" -std=c++20 -O2 -Wall -Wextra -Wshadow -Werror -I ue_stub -o out/space_test space_test.cpp
./out/space_test
# 2) Flugphysik: Browser-Spiel (JS) gegen C++
node --import ./js_stubs/register.mjs run_js.mjs
"$CXX" -std=c++20 -O2 -Wall -Wextra -Wshadow -Werror -I ue_stub -o out/flight_test flight_test.cpp ../Source/DragonTwinUE/Flight/DragonFlightModel.cpp
NAMES=$(node -e "import('./scenarios.mjs').then((m) => console.log(m.SCENARIOS.map((s) => s.name).join(' ')))")
./out/flight_test out/ $NAMES
node compare.mjs
# 3) Falls das .NET-SDK da ist: auch die C#-Version für s&box prüfen (sbox/Tests/)
if command -v dotnet >/dev/null 2>&1; then
	sh ../../sbox/Tests/run_all.sh --ohne-js
else
	echo "(C#-Version für s&box: übersprungen, dotnet fehlt)"
fi
