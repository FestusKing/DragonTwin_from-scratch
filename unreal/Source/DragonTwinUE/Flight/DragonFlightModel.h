// =====================================================================
//  FLUGPHYSIK DES DRACHEN – C++-Version für Unreal Engine
// =====================================================================
// 1:1 übertragen aus dem Browser-Spiel: src/dragon/FlightPhysics.js
// Dort sind alle Formeln ausführlich erklärt (Auftrieb, Widerstand, Anstellwinkel …).
// Gleiche Zahlen → gleiches Fluggefühl. Ein Test vergleicht beide Versionen:
// unreal/Tests/ (gleiche Eingaben → gleiche Flugbahn).
//
// WICHTIG: Diese Klasse rechnet im "Physik-Raum" – genau wie das Browser-Spiel:
//   Einheit Meter, +Y = oben, −Z = vorne (Blickrichtung), +X = rechts.
// Unreal hat Zentimeter, +Z oben, +X vorne, +Y rechts. Die Umrechnung steht in
// DragonSpace.h und passiert nur an der Grenze zu Unreal (im DragonPawn).
//
// Die Klasse ist KEIN UObject: nur Mathe. Darum kann man sie auch ohne Unreal testen.
// =====================================================================
#pragma once

#include "CoreMinimal.h"

/** Eingaben pro Bild (wie "input" in FlightPhysics.js) */
struct FDragonFlightInput
{
	double Pitch = 0.0;         // +1 = Nase hoch (S), −1 = Nase runter (W)
	double Roll = 0.0;          // +1 = nach rechts rollen (D), −1 = links (A)
	bool bFlap = false;         // Flügelschlag gehalten (Leertaste)
	bool bFlapPressed = false;  // Flügelschlag gerade gedrückt (zum Abheben)
	bool bDive = false;         // Sturzflug (Shift)
	bool bBoost = false;        // Boost (E)
	bool bHover = false;        // Bremsen / Schweben (V)
};

/** Die Welt aus Sicht der Flugphysik. Alle Werte im Physik-Raum (Meter, Y oben). */
class IDragonFlightWorld
{
public:
	virtual ~IDragonFlightWorld() = default;

	/** Bodenhöhe (m) an der Stelle (X, Z) */
	virtual double GroundHeight(double X, double Z) const = 0;

	/** Boden-Normale (Länge 1) an der Stelle (X, Z) */
	virtual FVector GroundNormal(double X, double Z) const = 0;

	/**
	 * Hindernisse (Gebäude, Felsen): Kugel (Pos, Radius) gegen die Welt.
	 * Rückgabe = Eindringtiefe (0 = frei). OutNormal = Richtung, in die geschoben wird.
	 */
	virtual double TestObstacles(const FVector& /*Pos*/, double /*Radius*/, FVector& /*OutNormal*/) const
	{
		return 0.0;
	}
};

/** Umgebung pro Bild (wie "env" in FlightPhysics.js) */
struct FDragonFlightEnv
{
	const IDragonFlightWorld* World = nullptr;
	FVector Wind = FVector(0.0, 0.0, 0.0); // m/s, Physik-Raum
	bool bAssist = true;                   // Flughilfe an/aus
	double Turbulence = 0.0;               // 0 = ruhig, bei Gewitter mehr
};

/** Zustand für die Animation des Modells (wie animState() in FlightPhysics.js) */
struct FDragonAnimState
{
	double FlapPhase = 0.0;
	double FlapAmp = 0.0;
	double Fold = 0.0;
	double Bank = 0.0;
	double PitchRate = 0.0;
	double YawRate = 0.0;
	double Roll = 0.0;
	double Speed = 0.0;
	double Agl = 0.0;
	double Hover = 0.0;
	double Grounded = 0.0;
	double Walk = 0.0;
	bool bBoost = false;
};

class FDragonFlightModel
{
public:
	// ---------------- Einstellbare Konstanten (wie in FlightPhysics.js) ----------------
	static constexpr double G = 9.81;             // Erdbeschleunigung (m/s²)
	static constexpr double K_AIR = 0.018;        // ½ · Luftdichte · Flügelfläche / Masse
	static constexpr double CL0 = 0.3;            // Auftrieb bei 0° Anstellwinkel
	static constexpr double CL_ALPHA = 4.2;       // Zusatz-Auftrieb pro Radiant Anstellwinkel
	static constexpr double STALL_ANGLE = 0.34;   // ≈ 20°: ab hier Strömungsabriss
	static constexpr double CD0 = 0.035;          // Grund-Widerstand
	static constexpr double K_INDUCED = 0.06;     // induzierter Widerstand
	static constexpr double BRAKE_CD = 0.7;       // Zusatz-Widerstand beim Bremsen
	static constexpr double MAX_G = 6.0;          // maximale Kurvenkraft in "g"

	static constexpr double PITCH_RATE = 1.45;    // max. Drehrate Nase hoch/runter (rad/s)
	static constexpr double ROLL_RATE = 2.6;      // max. Rollrate (rad/s)
	static constexpr double RESPONSE = 4.5;       // Trägheit der Drehung
	static constexpr double WEATHERVANE = 0.075;  // Nase dreht sich in Flugrichtung
	static constexpr double TRIM = 0.05;          // Nase leicht über der Flugbahn (ohne Flughilfe)
	static constexpr double MAX_BANK = 1.2;       // max. Schräglage mit Flughilfe (≈ 70°)

	static constexpr double FLAP_FREQ = 1.55;     // Flügelschläge pro Sekunde
	static constexpr double FLAP_FREQ_FAST = 2.3;
	static constexpr double BOOST_ACC = 16.0;     // Boost-Schub (m/s²)
	static constexpr double STAMINA_DRAIN = 0.28; // Ausdauer-Verbrauch pro Sekunde Boost
	static constexpr double STAMINA_REGEN = 0.14; // Erholung pro Sekunde
	static constexpr double BODY_RADIUS = 4.2;    // Kollisions-Kugel (m)
	static constexpr double STAND_HEIGHT = 2.62;  // Mittelpunkt über dem Boden im Stehen (m)
	static constexpr double WATER_LEVEL = 0.0;    // Meereshöhe (m)

	static constexpr double STEP = 1.0 / 120.0;   // feste Rechenschritte

	/** Ab hier wird man sanft zurückgelenkt (m). Im Browser-Spiel 2850 m (Insel 5 × 5 km). */
	double WorldRadius = 2850.0;

	// ---------------- Zustand (Physik-Raum) ----------------
	FVector Position = FVector(0.0, 200.0, 0.0);
	FVector Velocity = FVector(0.0, 0.0, -35.0);
	FQuat Rotation = FQuat(0.0, 0.0, 0.0, 1.0);
	FVector AngVel = FVector(0.0, 0.0, 0.0); // Drehraten im Körper-System: X = Nicken, Y = Gieren, Z = Rollen

	double Stamina = 1.0;
	double StaminaDelay = 0.0;
	bool bExhausted = false;
	double FlapPhase = 0.0;
	double FlapAmp = 0.0;
	double Fold = 0.0;
	bool bBoosting = false;
	bool bHovering = false;
	bool bBraking = false;
	bool bGrounded = false;
	bool bOnWater = false;
	double WalkSpeed = 0.0;
	double Agl = 100.0;             // Höhe über Boden oder Wasser
	double HeightAboveWater = 100.0;
	bool bOverWater = false;
	double Speed = 35.0;
	double YawRate = 0.0;
	double Bank = 0.0;
	double OutOfBounds = 0.0;
	bool bFrozen = false;           // z. B. Countdown vor einem Rennen

	// ---------------- Ereignisse (für Töne, Staub, Kamera-Wackeln) ----------------
	TFunction<void(double /*Stärke*/)> OnFlap;
	TFunction<void(double /*Stärke*/, bool /*Wasser*/)> OnImpact;
	TFunction<void(bool /*Wasser*/, double /*Aufprall-Tempo*/)> OnLand;
	TFunction<void()> OnTakeoff;
	TFunction<void(double /*Stärke*/)> OnSplash;

	/** Drache an eine Position setzen. InHeading = Blickrichtung in Radiant (0 = −Z). */
	void Reset(const FVector& Pos, double InHeading = 0.0, double InSpeed = 35.0);

	/** Einmal pro Bild aufrufen. Rechnet intern in festen Schritten (1/120 s). */
	void Update(double Dt, const FDragonFlightInput& Input, const FDragonFlightEnv& Env);

	FVector Forward() const;
	FVector Up() const;
	FVector Right() const;

	/** Zustand für die Animation */
	FDragonAnimState GetAnimState() const;

private:
	void Step(double Dt, const FDragonFlightInput& Input, const FDragonFlightEnv& Env);
	void HoverStep(double Dt, const FDragonFlightInput& Input, const FDragonFlightEnv& Env);
	void GroundStep(double Dt, const FDragonFlightInput& Input, const FDragonFlightEnv& Env);
	void Collide(double Dt, const FDragonFlightEnv& Env);

	double Heading = 0.0;
	double Accumulator = 0.0;
	FDragonFlightInput LastInput;
};
