// Flugphysik des Drachen – übertragen aus src/dragon/FlightPhysics.js (Browser-Spiel).
// Die Kommentare mit "JS:" zeigen, welche Stelle im Original gemeint ist.
// Namen im Physik-Raum: Forward = −Z, Up = +Y, Right = +X (wie three.js).
#include "DragonFlightModel.h"

// Eigener Namensraum (nicht anonym): Unreal fasst beim Bauen mehrere .cpp-Dateien zusammen
// ("Unity Build") – gleiche Namen in anonymen Namensräumen würden dann zusammenstossen.
namespace DragonFlightDetail
{
	const FVector PS_FWD(0.0, 0.0, -1.0);
	const FVector PS_UP(0.0, 1.0, 0.0);
	const FVector PS_RIGHT(1.0, 0.0, 0.0);
	constexpr double DT_PI = 3.14159265358979323846;
	constexpr double DT_TAU = 2.0 * DT_PI;

	/** Bildraten-unabhängiges Nachziehen (JS: damp in utils.js) */
	double Damp(double Current, double Target, double Lambda, double Dt)
	{
		return Current + (Target - Current) * (1.0 - FMath::Exp(-Lambda * Dt));
	}

	/** Winkel-Differenz im Bereich [−PI, PI] (JS: angleDiff in utils.js) */
	double AngleDiff(double A, double B)
	{
		double D = FMath::Fmod(B - A, DT_TAU);
		if (D > DT_PI) D -= DT_TAU;
		if (D < -DT_PI) D += DT_TAU;
		return D;
	}

	/** Auftriebsbeiwert je nach Anstellwinkel, mit Strömungsabriss (JS: liftCoefficient) */
	double LiftCoefficient(double Alpha)
	{
		const double Linear = FMath::Clamp(FDragonFlightModel::CL0 + FDragonFlightModel::CL_ALPHA * Alpha, -1.2, 1.75);
		// Nach dem Abriss verhält sich der Flügel wie eine flache Platte
		const double Plate = 1.1 * FMath::Sin(2.0 * Alpha);
		const double W = FMath::Clamp((FMath::Abs(Alpha) - FDragonFlightModel::STALL_ANGLE) / 0.2, 0.0, 1.0);
		return Linear * (1.0 - W) + Plate * W;
	}

	FVector Normalized(const FVector& V)
	{
		const double L = V.Size();
		return L > 0.0 ? V / L : V;
	}

	/**
	 * Drehung aus drei Achsen (Spalten einer Drehmatrix): lokal X → AxisX, Y → AxisY, Z → AxisZ.
	 * Gleicher Rechenweg wie three.js (Matrix4.makeBasis + Quaternion.setFromRotationMatrix).
	 */
	FQuat QuatFromBasis(const FVector& AxisX, const FVector& AxisY, const FVector& AxisZ)
	{
		const double M11 = AxisX.X, M12 = AxisY.X, M13 = AxisZ.X;
		const double M21 = AxisX.Y, M22 = AxisY.Y, M23 = AxisZ.Y;
		const double M31 = AxisX.Z, M32 = AxisY.Z, M33 = AxisZ.Z;
		const double Trace = M11 + M22 + M33;
		if (Trace > 0.0)
		{
			const double S = 0.5 / FMath::Sqrt(Trace + 1.0);
			return FQuat((M32 - M23) * S, (M13 - M31) * S, (M21 - M12) * S, 0.25 / S);
		}
		if (M11 > M22 && M11 > M33)
		{
			const double S = 2.0 * FMath::Sqrt(1.0 + M11 - M22 - M33);
			return FQuat(0.25 * S, (M12 + M21) / S, (M13 + M31) / S, (M32 - M23) / S);
		}
		if (M22 > M33)
		{
			const double S = 2.0 * FMath::Sqrt(1.0 + M22 - M11 - M33);
			return FQuat((M12 + M21) / S, 0.25 * S, (M23 + M32) / S, (M13 - M31) / S);
		}
		const double S = 2.0 * FMath::Sqrt(1.0 + M33 - M11 - M22);
		return FQuat((M13 + M31) / S, (M23 + M32) / S, 0.25 * S, (M21 - M12) / S);
	}
}
using namespace DragonFlightDetail;

// ---------------------------------------------------------------------------
void FDragonFlightModel::Reset(const FVector& Pos, double InHeading, double InSpeed)
{
	Position = Pos;
	Rotation = FQuat(PS_UP, InHeading);
	Velocity = Rotation.RotateVector(PS_FWD) * InSpeed;
	AngVel = FVector(0.0, 0.0, 0.0);
	bGrounded = false;
	bHovering = false;
	Stamina = 1.0;
	bExhausted = false;
	FlapAmp = InSpeed < 5.0 ? 0.8 : 0.0;
	Heading = InHeading;
}

FVector FDragonFlightModel::Forward() const { return Rotation.RotateVector(PS_FWD); }
FVector FDragonFlightModel::Up() const { return Rotation.RotateVector(PS_UP); }
FVector FDragonFlightModel::Right() const { return Rotation.RotateVector(PS_RIGHT); }

// ---------------------------------------------------------------------------
void FDragonFlightModel::Update(double Dt, const FDragonFlightInput& Input, const FDragonFlightEnv& Env)
{
	LastInput = Input;
	if (bFrozen)
	{
		// Countdown vor dem Rennen: in der Luft stehen, nur Flügel schlagen
		FlapPhase = FMath::Fmod(FlapPhase + Dt * FLAP_FREQ_FAST, 1.0);
		FlapAmp = Damp(FlapAmp, 0.9, 4.0, Dt);
		bHovering = true;
		Velocity = FVector(0.0, 0.0, 0.0);
		return;
	}
	Accumulator += FMath::Min(Dt, 0.1);
	int32 Steps = 0;
	while (Accumulator >= STEP && Steps < 12)
	{
		Step(STEP, Input, Env);
		Accumulator -= STEP;
		Steps++;
	}
	// Gierrate (für die Animation) aus der Kursänderung
	const FVector F = Forward();
	const double NewHeading = FMath::Atan2(-F.X, -F.Z);
	YawRate = Damp(YawRate, AngleDiff(Heading, NewHeading) / FMath::Max(Dt, 1e-4), 6.0, Dt);
	Heading = NewHeading;
	Speed = Velocity.Size();
	const double Ground = Env.World->GroundHeight(Position.X, Position.Z);
	Agl = Position.Y - FMath::Max(Ground, WATER_LEVEL);
	HeightAboveWater = Position.Y - WATER_LEVEL;
	bOverWater = Ground < WATER_LEVEL;
}

// ---------------------------------------------------------------------------
void FDragonFlightModel::Step(double Dt, const FDragonFlightInput& Input, const FDragonFlightEnv& Env)
{
	// ---------- Ausdauer & Boost ----------
	const bool bWantsBoost = Input.bBoost && !bGrounded && !bExhausted;
	bBoosting = bWantsBoost && Stamina > 0.0;
	if (bBoosting)
	{
		Stamina -= STAMINA_DRAIN * Dt;
		StaminaDelay = 1.0;
		if (Stamina <= 0.0)
		{
			Stamina = 0.0;
			bExhausted = true; // erst ab 25 % wieder boosten
		}
	}
	else
	{
		StaminaDelay -= Dt;
		if (StaminaDelay <= 0.0) Stamina = FMath::Min(1.0, Stamina + STAMINA_REGEN * Dt * (bGrounded ? 2.0 : 1.0));
		if (bExhausted && Stamina > 0.25) bExhausted = false;
	}

	if (bGrounded)
	{
		GroundStep(Dt, Input, Env);
		return;
	}

	// Richtungsvektoren des Drachen
	FVector F = Forward();
	FVector U = Up();
	FVector R = Right();
	// Luft relativ zum Drachen (Wind zählt mit!)
	const FVector Air = Velocity - Env.Wind;
	const double AirSpeed = Air.Size();

	// Schweben (V gedrückt und langsam genug) → eigener Modus.
	// Landen: sofort in den Schwebe-Modus (dort wird kräftig abgebremst).
	bBraking = Input.bHover && !Input.bLand && AirSpeed >= 24.0;
	bHovering = Input.bLand || (Input.bHover && (bHovering || AirSpeed < 24.0));
	if (bHovering)
	{
		HoverStep(Dt, Input, Env);
		Collide(Dt, Env);
		return;
	}

	// ---------- 1) DREHEN: Eingaben → Drehraten ----------
	const double Authority = FMath::Clamp(AirSpeed / 25.0, 0.35, 1.0);
	Bank = FMath::Atan2(-R.Y, U.Y); // > 0 = rechter Flügel unten
	const double Density = FMath::Clamp(1.0 - (Position.Y - 1400.0) / 900.0, 0.25, 1.0); // dünne Luft oben
	double Alpha = 0.0;
	double Beta = 0.0;
	if (AirSpeed > 1.0)
	{
		const FVector Dir = Air / AirSpeed;
		Alpha = FMath::Atan2(-(Dir | U), Dir | F);
		Beta = FMath::Asin(FMath::Clamp(Dir | R, -1.0, 1.0));
	}
	double TPitch;
	double TRoll;
	double TYaw;
	if (Env.bAssist)
	{
		// ===== FLUGHILFE ("Fly-by-Wire") =====
		// a) Auto-Trimm: so viel Anstellwinkel, dass der Auftrieb das Gewicht trägt
		const double Spread = 1.0 - 0.8 * Fold;
		const double Qd = K_AIR * Density * AirSpeed * AirSpeed;
		const double Gamma = FMath::Asin(FMath::Clamp(Air.Y / FMath::Max(AirSpeed, 1e-3), -1.0, 1.0)); // Steigwinkel
		const double CosBank = FMath::Max(FMath::Cos(Bank), 0.35);
		const double WantLift = FMath::Min(MAX_G * G, (G * FMath::Cos(Gamma) * 0.97) / CosBank);
		const double Trim = FMath::Clamp(((WantLift / FMath::Max(Qd * Spread, 1e-3)) - CL0) / CL_ALPHA, -0.15, STALL_ANGLE - 0.04);
		// b) S/W wählen den Ziel-Anstellwinkel (nie über den Abrisswinkel)
		const double MaxA = STALL_ANGLE - 0.03;
		double AlphaDes = Input.Pitch >= 0.0 ? Trim + Input.Pitch * (MaxA - Trim) : Trim + Input.Pitch * (Trim + 0.22);
		if (Input.bDive) AlphaDes = FMath::Min(AlphaDes, -0.02);
		TPitch = AirSpeed > 8.0 ? FMath::Clamp((AlphaDes - Alpha) * 10.0, -3.0, 3.0) : Input.Pitch * PITCH_RATE * Authority;
		// c) A/D geben eine ZIEL-Schräglage vor. Beim kräftigen Hochziehen (Looping) bleibt die Hilfe aus.
		const bool bPulling = FMath::Abs(Input.Pitch) > 0.5 && FMath::Abs(Input.Roll) < 0.1;
		if (FMath::Abs(F.Y) < 0.9 && !bPulling)
		{
			TRoll = FMath::Clamp(-(Input.Roll * MAX_BANK - Bank) * 3.0, -ROLL_RATE, ROLL_RATE) * Authority;
		}
		else
		{
			TRoll = -Input.Roll * ROLL_RATE * 0.5;
		}
		// d) Nase seitlich in die Flugrichtung drehen (kein Rutschen)
		TYaw = AirSpeed > 8.0 ? FMath::Clamp(-Beta * 4.0, -1.5, 1.5) : -Input.Roll * 0.4;
	}
	else
	{
		// Ohne Flughilfe: direkte Drehraten (Fassrollen und Loopings möglich!)
		TPitch = Input.Pitch * PITCH_RATE * Authority;
		TRoll = -Input.Roll * ROLL_RATE * Authority; // negativ = rechts rollen
		TYaw = -Input.Roll * 0.22 * Authority;
		if (Input.bDive) TPitch -= 0.15;
	}
	// Trägheit: die Drehrate nähert sich dem Ziel nur langsam an
	const double K = 1.0 - FMath::Exp(-(Env.bAssist ? RESPONSE_ASSIST : RESPONSE) * Dt);
	AngVel.X += (TPitch - AngVel.X) * K;
	AngVel.Y += (TYaw - AngVel.Y) * K;
	AngVel.Z += (TRoll - AngVel.Z) * K;
	// Drehung im Körper-System anwenden (q = q · Δq)
	{
		const FVector Turn = AngVel * Dt;
		const double Ang = Turn.Size();
		if (Ang > 1e-6)
		{
			Rotation = Rotation * FQuat(Turn / Ang, Ang);
		}
	}

	// ---------- 2) WINDFAHNEN-EFFEKT (ohne Flughilfe) ----------
	if (!Env.bAssist && AirSpeed > 3.0)
	{
		F = Forward();
		U = Up();
		const FVector Dir = Normalized(Air / AirSpeed + U * TRIM);
		const FVector Cross = FVector::CrossProduct(F, Dir);
		const double S = Cross.Size();
		if (S > 1e-5)
		{
			const double Angle = FMath::Atan2(S, F | Dir);
			const double Kw = FMath::Min(WEATHERVANE * AirSpeed, 6.0);
			Rotation = FQuat(Cross / S, Angle * (1.0 - FMath::Exp(-Kw * Dt))) * Rotation; // Welt-System: vorne
		}
	}
	else if (Env.bAssist && AirSpeed <= 8.0)
	{
		// Sehr langsam (Strömungsabriss): Nase kippt nach vorne-unten
		F = Forward();
		if (F.Y > -0.5)
		{
			R = Right();
			Rotation = FQuat(R, -0.8 * Dt) * Rotation;
		}
	}
	Rotation.Normalize();

	// ---------- 3) KRÄFTE ----------
	F = Forward();
	U = Up();
	R = Right();
	FVector Acc(0.0, -G, 0.0); // Schwerkraft

	// Flügel anlegen beim Sturzflug (weniger Auftrieb, weniger Widerstand)
	Fold = Damp(Fold, Input.bDive ? 0.85 : 0.0, 5.0, Dt);
	const double Spread = 1.0 - 0.8 * Fold;

	if (AirSpeed > 0.5)
	{
		const FVector Dir = Air / AirSpeed; // Flugrichtung
		const double A = FMath::Atan2(-(Dir | U), Dir | F);
		const double CL = LiftCoefficient(A) * Spread;
		const double Qd = K_AIR * Density * AirSpeed * AirSpeed; // "Staudruck"-Faktor

		// AUFTRIEB: senkrecht zur Flugrichtung, Richtung "oben" des Drachen
		const FVector LiftDir = Normalized(FVector::CrossProduct(R, Dir));
		const double Lift = FMath::Clamp(Qd * CL, -MAX_G * G, MAX_G * G);
		Acc += LiftDir * Lift;

		// WIDERSTAND: gegen die Flugrichtung (induzierter Teil hängt vom echten Auftrieb ab)
		const double CLeff = Lift / FMath::Max(Qd, 1e-3);
		double CD = CD0 - 0.018 * Fold + K_INDUCED * CLeff * CLeff;
		if (bBraking) CD += BRAKE_CD;
		if (AirSpeed > 120.0)
		{
			const double Over = (AirSpeed - 120.0) / 40.0;
			CD += Over * Over * 0.05; // Höchstgeschwindigkeit
		}
		Acc += Dir * (-Qd * CD);

		// SEITENKRAFT: verhindert seitliches Rutschen (Körper + Schwanz)
		const double Side = Air | R;
		Acc += R * (-Side * (0.4 + AirSpeed * 0.02));
	}

	// SCHUB 1: Flügelschlag (pulsierend, synchron zur Animation)
	// Flughilfe: langsam → von selbst flattern; langsam hochziehen → kräftig flattern
	const bool bClimbFlap = Env.bAssist && !Input.bDive && Input.Pitch > 0.3 && AirSpeed < 32.0;
	const bool bAutoFlap = (Env.bAssist && AirSpeed < 16.0 && !Input.bDive) || bClimbFlap;
	const bool bFlapping = Input.bFlap || bBoosting || bAutoFlap;
	const double TargetAmp = (Input.bFlap || bBoosting) ? 1.0 : (bClimbFlap ? 0.9 : (bAutoFlap ? 0.6 : 0.0));
	FlapAmp = Damp(FlapAmp, TargetAmp, 4.0, Dt);
	if (bFlapping || FlapAmp > 0.05)
	{
		const double Prev = FlapPhase;
		FlapPhase = FMath::Fmod(FlapPhase + Dt * (bBoosting ? FLAP_FREQ_FAST : FLAP_FREQ), 1.0);
		if (FlapPhase < Prev && FlapAmp > 0.3 && OnFlap) OnFlap(FlapAmp);
	}
	if (FlapAmp > 0.01)
	{
		// Nur der Abschlag (Phase 0–0.5) drückt richtig. Mittelwert der Formel = 1.
		const double Stroke = 0.4 + 0.6 * (FMath::Max(0.0, FMath::Sin(FlapPhase * DT_PI * 2.0)) / 0.318);
		// Beim steilen Steigen wird Flattern immer weniger wirksam (kein "Raketen-Drache")
		const double Climb = FMath::Clamp(1.0 - (Velocity.Y - 6.0) / 10.0, 0.15, 1.0);
		const double FwdThrust = (7.0 * FMath::Max(0.0, 1.0 - AirSpeed / 60.0) + 1.2) * Climb;
		const double UpThrust = (4.0 + 6.0 * FMath::Max(0.0, 1.0 - AirSpeed / 35.0)) * Climb;
		Acc += F * (FwdThrust * Stroke * FlapAmp * Density);
		// Hub zeigt überwiegend nach OBEN (Welt) – sonst würde Dauer-Flattern einen Looping machen
		const FVector LiftUp = Normalized(U + (PS_UP - U) * 0.7);
		Acc += LiftUp * (UpThrust * Stroke * FlapAmp * Density);
	}

	// SCHUB 2: Boost (verbraucht Ausdauer)
	if (bBoosting) Acc += F * (BOOST_ACC * FMath::Max(0.0, 1.0 - AirSpeed / 110.0) + 3.0);

	// Turbulenz bei Sturm
	if (Env.Turbulence > 0.0)
	{
		const double T = Env.Turbulence * 5.0;
		Acc.X += (FMath::FRand() - 0.5) * T;
		Acc.Y += (FMath::FRand() - 0.5) * T;
		Acc.Z += (FMath::FRand() - 0.5) * T;
	}

	// Kartenrand: sanft zurück zur Mitte lenken
	const double Dist = FMath::Sqrt(Position.X * Position.X + Position.Z * Position.Z);
	OutOfBounds = FMath::Clamp((Dist - WorldRadius) / 300.0, 0.0, 1.0);
	if (Dist > WorldRadius)
	{
		Acc += FVector(-Position.X / Dist, 0.0, -Position.Z / Dist) * ((Dist - WorldRadius) * 0.06);
		// auch die Nase Richtung Mitte drehen
		const double Want = FMath::Atan2(Position.X, Position.Z);
		const double D = AngleDiff(Heading, Want);
		Rotation = FQuat(PS_UP, D * Dt * 0.8 * OutOfBounds) * Rotation;
	}
	// Höhen-Decke
	if (Position.Y > 2600.0) Acc.Y -= (Position.Y - 2600.0) * 0.1;

	// ---------- 4) BEWEGEN ----------
	Velocity += Acc * Dt;
	Position += Velocity * Dt;

	Collide(Dt, Env);
}

// ---------------------------------------------------------------------------
// Schweben: Der Drache steht fast senkrecht in der Luft und schlägt kräftig.
void FDragonFlightModel::HoverStep(double Dt, const FDragonFlightInput& Input, const FDragonFlightEnv& Env)
{
	Fold = Damp(Fold, 0.0, 5.0, Dt);
	FlapAmp = Damp(FlapAmp, 1.0, 4.0, Dt);
	const double Prev = FlapPhase;
	FlapPhase = FMath::Fmod(FlapPhase + Dt * 2.1, 1.0);
	if (FlapPhase < Prev && OnFlap) OnFlap(0.9);

	// Gieren mit A/D (auf der Stelle drehen)
	const FVector F = Forward();
	double H = FMath::Atan2(-F.X, -F.Z);
	H -= Input.Roll * 1.3 * Dt;
	// Zielhaltung: Nase 22° hoch, keine Schräglage (JS: Euler YXZ = erst gieren, dann nicken).
	// Landen: je schneller noch, desto steiler aufrichten (Flügel bremsen wie bei einem Adler)
	const bool bLand = Input.bLand;
	const double Move = bLand ? 0.0 : Input.Move;
	const double Hs = FMath::Sqrt(Velocity.X * Velocity.X + Velocity.Z * Velocity.Z);
	const double Flare = bLand ? FMath::Min(Hs / 30.0, 1.0) * 0.5 : 0.0;
	const FQuat Target = FQuat(PS_UP, H) * FQuat(PS_RIGHT, 0.38 - Move * 0.1 + Flare);
	Rotation = FQuat::Slerp(Rotation, Target, 1.0 - FMath::Exp(-3.0 * Dt));
	AngVel *= FMath::Exp(-5.0 * Dt);
	Bank = 0.0;

	// Gewünschte Geschwindigkeit: W vor, S zurück, Leertaste hoch, Shift runter
	const FVector Dir(-FMath::Sin(H), 0.0, -FMath::Cos(H));
	FVector Want = Dir * (Move * (Move > 0.0 ? 12.0 : 6.0));
	Want.Y = (Input.bFlap ? 9.0 : 0.0) - (Input.bDive ? 9.0 : 0.0);
	if (bLand)
	{
		// hoch oben schnell sinken, kurz vor dem Boden ganz sanft
		const double Above = Position.Y - FMath::Max(Env.World->GroundHeight(Position.X, Position.Z), WATER_LEVEL) - STAND_HEIGHT;
		Want.Y = -FMath::Clamp(Above * 0.8, 2.5, 20.0);
	}
	Want += Env.Wind * 0.25;
	const double K = 1.0 - FMath::Exp(-1.8 * Dt);
	Velocity.X += (Want.X - Velocity.X) * K;
	Velocity.Y += (Want.Y - Velocity.Y) * K;
	Velocity.Z += (Want.Z - Velocity.Z) * K;
	Position += Velocity * Dt;
}

// ---------------------------------------------------------------------------
// Am Boden: gehen, drehen, mit Leertaste abheben
void FDragonFlightModel::GroundStep(double Dt, const FDragonFlightInput& Input, const FDragonFlightEnv& Env)
{
	bHovering = false;
	bBraking = false;
	Fold = Damp(Fold, 0.0, 5.0, Dt);
	FlapAmp = Damp(FlapAmp, 0.0, 5.0, Dt);
	const FVector F = Forward();
	double H = FMath::Atan2(-F.X, -F.Z);
	// W vorwärts, S rückwärts, mit Boost rennen. Beim Rennen dreht der Drache weniger eng.
	const double Move = Input.Move;
	const bool bRun = Input.bBoost && Move > 0.1;
	H -= Input.Roll * (bRun ? 1.1 : 1.7) * Dt;
	const double Target = Move > 0.1 ? Move * (bRun ? WALK_RUN : WALK_SPEED) : (Move < -0.1 ? Move * 3.0 : 0.0);
	WalkSpeed = Damp(WalkSpeed, Target, 4.0, Dt);
	const double Hx = -FMath::Sin(H);
	const double Hz = -FMath::Cos(H);
	Position.X += Hx * WalkSpeed * Dt;
	Position.Z += Hz * WalkSpeed * Dt;
	const double Gh = Env.World->GroundHeight(Position.X, Position.Z);
	bOnWater = Gh < WATER_LEVEL;
	const double Surface = FMath::Max(Gh, WATER_LEVEL);
	const double StandY = Surface + (bOnWater ? STAND_HEIGHT * 0.45 : STAND_HEIGHT);
	Position.Y = Damp(Position.Y, StandY, 10.0, Dt);
	Velocity = FVector(Hx * WalkSpeed, 0.0, Hz * WalkSpeed);

	// Körper an den Boden anpassen (Hang)
	const FVector N = bOnWater ? PS_UP : Env.World->GroundNormal(Position.X, Position.Z);
	const FVector Ahead(Hx, 0.0, Hz);
	const FVector R = Normalized(FVector::CrossProduct(Ahead, N));    // rechts
	const FVector Fwd = Normalized(FVector::CrossProduct(N, R));      // vorne, parallel zum Hang
	const FQuat Target2 = QuatFromBasis(R, N, -Fwd);                  // lokal −Z = vorne
	Rotation = FQuat::Slerp(Rotation, Target2, 1.0 - FMath::Exp(-6.0 * Dt));

	Collide(Dt, Env);

	// Abheben!
	if (Input.bFlapPressed || (Input.bFlap && Stamina > 0.05))
	{
		bGrounded = false;
		Velocity = Ahead * 14.0 + FVector(0.0, 13.0, 0.0);
		FlapAmp = 1.0;
		FlapPhase = 0.0;
		if (OnTakeoff) OnTakeoff();
		if (OnFlap) OnFlap(1.2);
	}
}

// ---------------------------------------------------------------------------
// Boden, Wasser und Hindernisse
void FDragonFlightModel::Collide(double Dt, const FDragonFlightEnv& Env)
{
	const double Gh = Env.World->GroundHeight(Position.X, Position.Z);
	const bool bWater = Gh < WATER_LEVEL;
	const double Surface = FMath::Max(Gh, WATER_LEVEL);
	const double MinY = Surface + (bWater ? STAND_HEIGHT * 0.45 : STAND_HEIGHT);

	if (!bGrounded && Position.Y < MinY)
	{
		const FVector N = bWater ? PS_UP : Env.World->GroundNormal(Position.X, Position.Z);
		const double Into = -(Velocity | N); // wie schnell geht es "in den Boden"?
		Position.Y = MinY;
		const double Spd = Velocity.Size();
		if (bWater && Into > 2.0 && OnSplash) OnSplash(FMath::Clamp(Spd / 50.0, 0.3, 1.5));
		if (Into > 14.0 && Spd > 20.0)
		{
			// harter Aufprall → abprallen
			Velocity += N * (Into * 1.35);
			Velocity *= 0.55;
			Stamina = FMath::Max(0.0, Stamina - 0.2);
			if (OnImpact) OnImpact(FMath::Clamp(Into / 30.0, 0.3, 1.5), bWater);
		}
		else if (Into > 0.0)
		{
			// weich: Geschwindigkeit in den Boden entfernen, Reibung
			Velocity += N * Into;
			Velocity *= FMath::Exp(-(bWater ? 1.5 : 1.0) * Dt);
			const double Horiz = FMath::Sqrt(Velocity.X * Velocity.X + Velocity.Z * Velocity.Z);
			if (Horiz < 14.0 && !bHovering)
			{
				bGrounded = true;
				WalkSpeed = 0.0;
				Velocity = FVector(0.0, 0.0, 0.0);
				if (OnLand) OnLand(bWater, Into);
			}
		}
		if (bHovering && Position.Y <= MinY + 0.01 && Velocity.Y <= 0.1)
		{
			bHovering = false;
			bGrounded = true;
			if (OnLand) OnLand(bWater, 2.0);
		}
	}

	// Gebäude & Felsen
	for (int32 I = 0; I < 3; I++)
	{
		FVector N(0.0, 0.0, 0.0);
		const double Depth = Env.World->TestObstacles(Position, BODY_RADIUS, N);
		if (Depth <= 0.0) break;
		Position += N * Depth;
		const double Vn = Velocity | N;
		if (Vn < 0.0)
		{
			Velocity += N * (-Vn * 1.25);
			if (-Vn > 18.0)
			{
				Velocity *= 0.7;
				Stamina = FMath::Max(0.0, Stamina - 0.15);
				if (OnImpact) OnImpact(FMath::Clamp(-Vn / 35.0, 0.3, 1.4), false);
			}
		}
	}
}

// ---------------------------------------------------------------------------
FDragonAnimState FDragonFlightModel::GetAnimState() const
{
	FDragonAnimState S;
	S.FlapPhase = FlapPhase;
	S.FlapAmp = FlapAmp;
	S.Fold = Fold;
	S.Bank = Bank;
	S.PitchRate = AngVel.X;
	S.YawRate = YawRate;
	S.Roll = LastInput.Roll;
	S.Speed = Speed;
	S.Agl = Agl;
	S.Hover = (bHovering || bFrozen) ? 1.0 : 0.0;
	S.Grounded = bGrounded ? 1.0 : 0.0;
	S.Walk = bGrounded ? FMath::Min(1.0, FMath::Abs(WalkSpeed) / 6.0) : 0.0;
	S.bBoost = bBoosting;
	return S;
}
