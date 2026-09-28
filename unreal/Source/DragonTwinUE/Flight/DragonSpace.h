// Umrechnung zwischen Unreal und dem Physik-Raum der Flugphysik (DragonFlightModel).
//
//   Physik-Raum (wie das Browser-Spiel): Meter,      X = rechts, Y = oben,  −Z = vorne
//   Unreal:                              Zentimeter, X = vorne,  Y = rechts, Z = oben
//
//   Unreal.X = −Physik.Z · 100
//   Unreal.Y =  Physik.X · 100
//   Unreal.Z =  Physik.Y · 100
//
// Achtung Drehungen: Das Browser-Spiel rechnet "rechtshändig", Unreal "linkshändig".
// Darum dreht sich beim Umrechnen der Drehsinn um (Vorzeichen im Quaternion).
// Ein Test prüft das: unreal/Tests/space_test.cpp
#pragma once

#include "CoreMinimal.h"

namespace DragonSpace
{
	constexpr double CmPerMeter = 100.0;

	/** Richtung (ohne Längen-Umrechnung): Physik → Unreal */
	inline FVector DirToUnreal(const FVector& P) { return FVector(-P.Z, P.X, P.Y); }

	/** Richtung (ohne Längen-Umrechnung): Unreal → Physik */
	inline FVector DirToPhysics(const FVector& U) { return FVector(U.Y, U.Z, -U.X); }

	/** Punkt: Physik (m) → Unreal (cm) */
	inline FVector ToUnreal(const FVector& P) { return DirToUnreal(P) * CmPerMeter; }

	/** Punkt: Unreal (cm) → Physik (m) */
	inline FVector ToPhysics(const FVector& U) { return DirToPhysics(U) / CmPerMeter; }

	/** Drehung: Physik → Unreal */
	inline FQuat QuatToUnreal(const FQuat& Q) { return FQuat(Q.Z, -Q.X, -Q.Y, Q.W); }

	/** Drehung: Unreal → Physik */
	inline FQuat QuatToPhysics(const FQuat& Q) { return FQuat(-Q.Y, -Q.Z, Q.X, Q.W); }
}
