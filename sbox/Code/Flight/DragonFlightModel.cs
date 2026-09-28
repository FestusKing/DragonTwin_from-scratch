// =====================================================================
//  FLUGPHYSIK DES DRACHEN – C#-Version für s&box
// =====================================================================
// 1:1 übertragen aus der C++-Version (unreal/Source/DragonTwinUE/Flight/DragonFlightModel.cpp),
// die wiederum 1:1 aus dem Browser-Spiel stammt (src/dragon/FlightPhysics.js).
// Dort sind alle Formeln ausführlich erklärt (Auftrieb, Widerstand, Anstellwinkel …).
// Gleiche Zahlen → gleiches Fluggefühl. Ein Test vergleicht alle Versionen:
// sbox/Tests/run_all.sh (gleiche Eingaben → gleiche Flugbahn).
//
// WICHTIG: Diese Klasse rechnet im "Physik-Raum" – genau wie das Browser-Spiel:
//   Einheit Meter, +Y = oben, −Z = vorne (Blickrichtung), +X = rechts.
// s&box hat Zoll (inch), +Z oben, +X vorne, +Y links. Die Umrechnung steht in
// DragonSpace.cs und passiert nur an der Grenze zu s&box (im DragonController).
//
// Die Klasse braucht NICHTS von s&box: nur Mathe. Darum kann man sie auch ohne s&box testen.
// =====================================================================
using System;

namespace DragonFlight;

/** Eingaben pro Bild (wie "input" in FlightPhysics.js) */
public struct DragonFlightInput
{
	public double Pitch;       // +1 = Nase hoch (W), −1 = Nase runter (S) – im Flug
	public double Move;        // +1 = vorwärts (W), −1 = rückwärts (S) – am Boden und beim Schweben
	public double Roll;        // +1 = nach rechts rollen (D), −1 = links (A)
	public bool Flap;          // Flügelschlag gehalten (Leertaste)
	public bool FlapPressed;   // Flügelschlag gerade gedrückt (zum Abheben)
	public bool Dive;          // Sturzflug (Shift)
	public bool Boost;         // Boost (E)
	public bool Hover;         // Bremsen / Schweben (V)
	public bool Land;          // Landeanflug: abbremsen, aufrichten, sanft aufsetzen (L)
}

/** Die Welt aus Sicht der Flugphysik. Alle Werte im Physik-Raum (Meter, Y oben). */
public interface IDragonFlightWorld
{
	/** Bodenhöhe (m) an der Stelle (x, z) */
	double GroundHeight( double x, double z );

	/** Boden-Normale (Länge 1) an der Stelle (x, z) */
	DVec3 GroundNormal( double x, double z );

	/**
	 * Hindernisse (Gebäude, Felsen): Kugel (pos, radius) gegen die Welt.
	 * Rückgabe = Eindringtiefe (0 = frei). normal = Richtung, in die geschoben wird.
	 */
	double TestObstacles( DVec3 pos, double radius, out DVec3 normal );
}

/** Umgebung pro Bild (wie "env" in FlightPhysics.js) */
public struct DragonFlightEnv
{
	public IDragonFlightWorld World;
	public DVec3 Wind;         // m/s, Physik-Raum
	public bool Assist;        // Flughilfe an/aus
	public double Turbulence;  // 0 = ruhig, bei Gewitter mehr
}

/** Zustand für die Animation des Modells (wie animState() in FlightPhysics.js) */
public struct DragonAnimState
{
	public double FlapPhase;
	public double FlapAmp;
	public double Fold;
	public double Bank;
	public double PitchRate;
	public double YawRate;
	public double Roll;
	public double Speed;
	public double Agl;
	public double Hover;
	public double Grounded;
	public double Walk;
	public bool Boost;
}

public class DragonFlightModel
{
	// ---------------- Einstellbare Konstanten (wie in FlightPhysics.js) ----------------
	public const double G = 9.81;             // Erdbeschleunigung (m/s²)
	public const double K_AIR = 0.018;        // ½ · Luftdichte · Flügelfläche / Masse
	public const double CL0 = 0.3;            // Auftrieb bei 0° Anstellwinkel
	public const double CL_ALPHA = 4.2;       // Zusatz-Auftrieb pro Radiant Anstellwinkel
	public const double STALL_ANGLE = 0.34;   // ≈ 20°: ab hier Strömungsabriss
	public const double CD0 = 0.035;          // Grund-Widerstand
	public const double K_INDUCED = 0.06;     // induzierter Widerstand
	public const double BRAKE_CD = 0.7;       // Zusatz-Widerstand beim Bremsen
	public const double MAX_G = 6.0;          // maximale Kurvenkraft in "g"

	public const double PITCH_RATE = 1.45;    // max. Drehrate Nase hoch/runter (rad/s)
	public const double ROLL_RATE = 2.6;      // max. Rollrate (rad/s)
	public const double RESPONSE = 4.5;       // Trägheit der Drehung
	public const double RESPONSE_ASSIST = 8.0; // mit Flughilfe: schnellere Reaktion
	public const double WEATHERVANE = 0.075;  // Nase dreht sich in Flugrichtung
	public const double TRIM = 0.05;          // Nase leicht über der Flugbahn (ohne Flughilfe)
	public const double MAX_BANK = 1.2;       // max. Schräglage mit Flughilfe (≈ 70°)

	public const double FLAP_FREQ = 1.55;     // Flügelschläge pro Sekunde
	public const double FLAP_FREQ_FAST = 2.3;
	public const double BOOST_ACC = 16.0;     // Boost-Schub (m/s²)
	public const double STAMINA_DRAIN = 0.28; // Ausdauer-Verbrauch pro Sekunde Boost
	public const double STAMINA_REGEN = 0.14; // Erholung pro Sekunde
	public const double BODY_RADIUS = 4.2;    // Kollisions-Kugel (m)
	public const double STAND_HEIGHT = 2.62;  // Mittelpunkt über dem Boden im Stehen (m)
	public const double WALK_SPEED = 8.0;     // Gehen am Boden (m/s)
	public const double WALK_RUN = 17.0;      // Rennen am Boden mit Boost (m/s)
	public const double WATER_LEVEL = 0.0;    // Meereshöhe (m)

	public const double STEP = 1.0 / 120.0;   // feste Rechenschritte

	/** Ab hier wird man sanft zurückgelenkt (m). Im Browser-Spiel 2850 m (Insel 5 × 5 km). */
	public double WorldRadius = 2850.0;

	// ---------------- Zustand (Physik-Raum) ----------------
	public DVec3 Position = new( 0.0, 200.0, 0.0 );
	public DVec3 Velocity = new( 0.0, 0.0, -35.0 );
	public DQuat Rotation = DQuat.Identity;
	public DVec3 AngVel = DVec3.Zero; // Drehraten im Körper-System: X = Nicken, Y = Gieren, Z = Rollen

	public double Stamina = 1.0;
	public double StaminaDelay = 0.0;
	public bool Exhausted = false;
	public double FlapPhase = 0.0;
	public double FlapAmp = 0.0;
	public double Fold = 0.0;
	public bool Boosting = false;
	public bool Hovering = false;
	public bool Braking = false;
	public bool Grounded = false;
	public bool OnWater = false;
	public double WalkSpeed = 0.0;
	public double Agl = 100.0;             // Höhe über Boden oder Wasser
	public double HeightAboveWater = 100.0;
	public bool OverWater = false;
	public double Speed = 35.0;
	public double YawRate = 0.0;
	public double Bank = 0.0;
	public double OutOfBounds = 0.0;
	public bool Frozen = false;            // z. B. Countdown vor einem Rennen

	// ---------------- Ereignisse (für Töne, Staub, Kamera-Wackeln) ----------------
	public Action<double> OnFlap;                // Stärke
	public Action<double, bool> OnImpact;        // Stärke, Wasser?
	public Action<bool, double> OnLand;          // Wasser?, Aufprall-Tempo
	public Action OnTakeoff;
	public Action<double> OnSplash;              // Stärke

	double heading = 0.0;
	double accumulator = 0.0;
	DragonFlightInput lastInput;
	uint rng = 1234; // nur für Turbulenz

	static readonly DVec3 PS_FWD = new( 0.0, 0.0, -1.0 );
	static readonly DVec3 PS_UP = new( 0.0, 1.0, 0.0 );
	static readonly DVec3 PS_RIGHT = new( 1.0, 0.0, 0.0 );
	const double PI = 3.14159265358979323846;
	const double TAU = 2.0 * PI;

	// ---------------- Hilfen (wie in der C++-Version) ----------------
	static double Clamp( double v, double a, double b ) => v < a ? a : (v < b ? v : b);
	static double Min( double a, double b ) => a < b ? a : b;
	static double Max( double a, double b ) => a < b ? b : a;

	/** Bildraten-unabhängiges Nachziehen (JS: damp in utils.js) */
	static double Damp( double current, double target, double lambda, double dt ) =>
		current + (target - current) * (1.0 - Math.Exp( -lambda * dt ));

	/** Winkel-Differenz im Bereich [−PI, PI] (JS: angleDiff in utils.js) */
	static double AngleDiff( double a, double b )
	{
		double d = (b - a) % TAU; // % bei double = fmod (Vorzeichen wie b − a)
		if ( d > PI ) d -= TAU;
		if ( d < -PI ) d += TAU;
		return d;
	}

	/** Auftriebsbeiwert je nach Anstellwinkel, mit Strömungsabriss (JS: liftCoefficient) */
	static double LiftCoefficient( double alpha )
	{
		double linear = Clamp( CL0 + CL_ALPHA * alpha, -1.2, 1.75 );
		// Nach dem Abriss verhält sich der Flügel wie eine flache Platte
		double plate = 1.1 * Math.Sin( 2.0 * alpha );
		double w = Clamp( (Math.Abs( alpha ) - STALL_ANGLE) / 0.2, 0.0, 1.0 );
		return linear * (1.0 - w) + plate * w;
	}

	static DVec3 Normalized( DVec3 v )
	{
		double l = v.Length;
		return l > 0.0 ? v / l : v;
	}

	/**
	 * Drehung aus drei Achsen (Spalten einer Drehmatrix): lokal X → axisX, Y → axisY, Z → axisZ.
	 * Gleicher Rechenweg wie three.js (Matrix4.makeBasis + Quaternion.setFromRotationMatrix).
	 */
	static DQuat QuatFromBasis( DVec3 axisX, DVec3 axisY, DVec3 axisZ )
	{
		double m11 = axisX.X, m12 = axisY.X, m13 = axisZ.X;
		double m21 = axisX.Y, m22 = axisY.Y, m23 = axisZ.Y;
		double m31 = axisX.Z, m32 = axisY.Z, m33 = axisZ.Z;
		double trace = m11 + m22 + m33;
		if ( trace > 0.0 )
		{
			double s = 0.5 / Math.Sqrt( trace + 1.0 );
			return new DQuat( (m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s );
		}
		if ( m11 > m22 && m11 > m33 )
		{
			double s = 2.0 * Math.Sqrt( 1.0 + m11 - m22 - m33 );
			return new DQuat( 0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s );
		}
		if ( m22 > m33 )
		{
			double s = 2.0 * Math.Sqrt( 1.0 + m22 - m11 - m33 );
			return new DQuat( (m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s );
		}
		{
			double s = 2.0 * Math.Sqrt( 1.0 + m33 - m11 - m22 );
			return new DQuat( (m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s );
		}
	}

	/** Zufallszahl 0 … 1 (nur für Turbulenz; eigener kleiner Generator, braucht nichts von aussen) */
	double Rand()
	{
		rng ^= rng << 13;
		rng ^= rng >> 17;
		rng ^= rng << 5;
		return (rng & 0xFFFFFF) / (double)0x1000000;
	}

	// ---------------------------------------------------------------------------
	/** Drache an eine Position setzen. heading = Blickrichtung in Radiant (0 = −Z). */
	public void Reset( DVec3 pos, double inHeading = 0.0, double inSpeed = 35.0 )
	{
		Position = pos;
		Rotation = DQuat.FromAxisAngle( PS_UP, inHeading );
		Velocity = Rotation.Rotate( PS_FWD ) * inSpeed;
		AngVel = DVec3.Zero;
		Grounded = false;
		Hovering = false;
		Stamina = 1.0;
		Exhausted = false;
		FlapAmp = inSpeed < 5.0 ? 0.8 : 0.0;
		heading = inHeading;
	}

	public DVec3 Forward => Rotation.Rotate( PS_FWD );
	public DVec3 Up => Rotation.Rotate( PS_UP );
	public DVec3 Right => Rotation.Rotate( PS_RIGHT );

	// ---------------------------------------------------------------------------
	/** Einmal pro Bild aufrufen. Rechnet intern in festen Schritten (1/120 s). */
	public void Update( double dt, DragonFlightInput input, DragonFlightEnv env )
	{
		lastInput = input;
		if ( Frozen )
		{
			// Countdown vor dem Rennen: in der Luft stehen, nur Flügel schlagen
			FlapPhase = (FlapPhase + dt * FLAP_FREQ_FAST) % 1.0;
			FlapAmp = Damp( FlapAmp, 0.9, 4.0, dt );
			Hovering = true;
			Velocity = DVec3.Zero;
			return;
		}
		accumulator += Min( dt, 0.1 );
		int steps = 0;
		while ( accumulator >= STEP && steps < 12 )
		{
			Step( STEP, input, env );
			accumulator -= STEP;
			steps++;
		}
		// Gierrate (für die Animation) aus der Kursänderung
		DVec3 f = Forward;
		double newHeading = Math.Atan2( -f.X, -f.Z );
		YawRate = Damp( YawRate, AngleDiff( heading, newHeading ) / Max( dt, 1e-4 ), 6.0, dt );
		heading = newHeading;
		Speed = Velocity.Length;
		double ground = env.World.GroundHeight( Position.X, Position.Z );
		Agl = Position.Y - Max( ground, WATER_LEVEL );
		HeightAboveWater = Position.Y - WATER_LEVEL;
		OverWater = ground < WATER_LEVEL;
	}

	// ---------------------------------------------------------------------------
	void Step( double dt, DragonFlightInput input, DragonFlightEnv env )
	{
		// ---------- Ausdauer & Boost ----------
		bool wantsBoost = input.Boost && !Grounded && !Exhausted;
		Boosting = wantsBoost && Stamina > 0.0;
		if ( Boosting )
		{
			Stamina -= STAMINA_DRAIN * dt;
			StaminaDelay = 1.0;
			if ( Stamina <= 0.0 )
			{
				Stamina = 0.0;
				Exhausted = true; // erst ab 25 % wieder boosten
			}
		}
		else
		{
			StaminaDelay -= dt;
			if ( StaminaDelay <= 0.0 ) Stamina = Min( 1.0, Stamina + STAMINA_REGEN * dt * (Grounded ? 2.0 : 1.0) );
			if ( Exhausted && Stamina > 0.25 ) Exhausted = false;
		}

		if ( Grounded )
		{
			GroundStep( dt, input, env );
			return;
		}

		// Richtungsvektoren des Drachen
		DVec3 f = Forward;
		DVec3 u = Up;
		DVec3 r = Right;
		// Luft relativ zum Drachen (Wind zählt mit!)
		DVec3 air = Velocity - env.Wind;
		double airSpeed = air.Length;

		// Schweben (V gedrückt und langsam genug) → eigener Modus.
		// Landen: sofort in den Schwebe-Modus (dort wird kräftig abgebremst).
		Braking = input.Hover && !input.Land && airSpeed >= 24.0;
		Hovering = input.Land || (input.Hover && (Hovering || airSpeed < 24.0));
		if ( Hovering )
		{
			HoverStep( dt, input, env );
			Collide( dt, env );
			return;
		}

		// ---------- 1) DREHEN: Eingaben → Drehraten ----------
		double authority = Clamp( airSpeed / 25.0, 0.35, 1.0 );
		Bank = Math.Atan2( -r.Y, u.Y ); // > 0 = rechter Flügel unten
		double density = Clamp( 1.0 - (Position.Y - 1400.0) / 900.0, 0.25, 1.0 ); // dünne Luft oben
		double alpha = 0.0;
		double beta = 0.0;
		if ( airSpeed > 1.0 )
		{
			DVec3 dir = air / airSpeed;
			alpha = Math.Atan2( -DVec3.Dot( dir, u ), DVec3.Dot( dir, f ) );
			beta = Math.Asin( Clamp( DVec3.Dot( dir, r ), -1.0, 1.0 ) );
		}
		double tPitch;
		double tRoll;
		double tYaw;
		if ( env.Assist )
		{
			// ===== FLUGHILFE ("Fly-by-Wire") =====
			// a) Auto-Trimm: so viel Anstellwinkel, dass der Auftrieb das Gewicht trägt
			double spreadA = 1.0 - 0.8 * Fold;
			double qdA = K_AIR * density * airSpeed * airSpeed;
			double gamma = Math.Asin( Clamp( air.Y / Max( airSpeed, 1e-3 ), -1.0, 1.0 ) ); // Steigwinkel
			double cosBank = Max( Math.Cos( Bank ), 0.35 );
			double wantLift = Min( MAX_G * G, (G * Math.Cos( gamma ) * 0.97) / cosBank );
			double trim = Clamp( ((wantLift / Max( qdA * spreadA, 1e-3 )) - CL0) / CL_ALPHA, -0.15, STALL_ANGLE - 0.04 );
			// b) S/W wählen den Ziel-Anstellwinkel (nie über den Abrisswinkel)
			double maxA = STALL_ANGLE - 0.03;
			double alphaDes = input.Pitch >= 0.0 ? trim + input.Pitch * (maxA - trim) : trim + input.Pitch * (trim + 0.22);
			if ( input.Dive ) alphaDes = Min( alphaDes, -0.02 );
			tPitch = airSpeed > 8.0 ? Clamp( (alphaDes - alpha) * 10.0, -3.0, 3.0 ) : input.Pitch * PITCH_RATE * authority;
			// c) A/D geben eine ZIEL-Schräglage vor. Beim kräftigen Hochziehen (Looping) bleibt die Hilfe aus.
			bool pulling = Math.Abs( input.Pitch ) > 0.5 && Math.Abs( input.Roll ) < 0.1;
			if ( Math.Abs( f.Y ) < 0.9 && !pulling )
			{
				tRoll = Clamp( -(input.Roll * MAX_BANK - Bank) * 3.0, -ROLL_RATE, ROLL_RATE ) * authority;
			}
			else
			{
				tRoll = -input.Roll * ROLL_RATE * 0.5;
			}
			// d) Nase seitlich in die Flugrichtung drehen (kein Rutschen)
			tYaw = airSpeed > 8.0 ? Clamp( -beta * 4.0, -1.5, 1.5 ) : -input.Roll * 0.4;
		}
		else
		{
			// Ohne Flughilfe: direkte Drehraten (Fassrollen und Loopings möglich!)
			tPitch = input.Pitch * PITCH_RATE * authority;
			tRoll = -input.Roll * ROLL_RATE * authority; // negativ = rechts rollen
			tYaw = -input.Roll * 0.22 * authority;
			if ( input.Dive ) tPitch -= 0.15;
		}
		// Trägheit: die Drehrate nähert sich dem Ziel nur langsam an
		double k = 1.0 - Math.Exp( -(env.Assist ? RESPONSE_ASSIST : RESPONSE) * dt );
		AngVel.X += (tPitch - AngVel.X) * k;
		AngVel.Y += (tYaw - AngVel.Y) * k;
		AngVel.Z += (tRoll - AngVel.Z) * k;
		// Drehung im Körper-System anwenden (q = q · Δq)
		{
			DVec3 turn = AngVel * dt;
			double ang = turn.Length;
			if ( ang > 1e-6 )
			{
				Rotation = Rotation * DQuat.FromAxisAngle( turn / ang, ang );
			}
		}

		// ---------- 2) WINDFAHNEN-EFFEKT (ohne Flughilfe) ----------
		if ( !env.Assist && airSpeed > 3.0 )
		{
			f = Forward;
			u = Up;
			DVec3 dir = Normalized( air / airSpeed + u * TRIM );
			DVec3 cross = DVec3.Cross( f, dir );
			double s = cross.Length;
			if ( s > 1e-5 )
			{
				double angle = Math.Atan2( s, DVec3.Dot( f, dir ) );
				double kw = Min( WEATHERVANE * airSpeed, 6.0 );
				Rotation = DQuat.FromAxisAngle( cross / s, angle * (1.0 - Math.Exp( -kw * dt )) ) * Rotation; // Welt-System: vorne
			}
		}
		else if ( env.Assist && airSpeed <= 8.0 )
		{
			// Sehr langsam (Strömungsabriss): Nase kippt nach vorne-unten
			f = Forward;
			if ( f.Y > -0.5 )
			{
				r = Right;
				Rotation = DQuat.FromAxisAngle( r, -0.8 * dt ) * Rotation;
			}
		}
		Rotation = Rotation.Normalized();

		// ---------- 3) KRÄFTE ----------
		f = Forward;
		u = Up;
		r = Right;
		var acc = new DVec3( 0.0, -G, 0.0 ); // Schwerkraft

		// Flügel anlegen beim Sturzflug (weniger Auftrieb, weniger Widerstand)
		Fold = Damp( Fold, input.Dive ? 0.85 : 0.0, 5.0, dt );
		double spread = 1.0 - 0.8 * Fold;

		if ( airSpeed > 0.5 )
		{
			DVec3 dir = air / airSpeed; // Flugrichtung
			double a = Math.Atan2( -DVec3.Dot( dir, u ), DVec3.Dot( dir, f ) );
			double cl = LiftCoefficient( a ) * spread;
			double qd = K_AIR * density * airSpeed * airSpeed; // "Staudruck"-Faktor

			// AUFTRIEB: senkrecht zur Flugrichtung, Richtung "oben" des Drachen
			DVec3 liftDir = Normalized( DVec3.Cross( r, dir ) );
			double lift = Clamp( qd * cl, -MAX_G * G, MAX_G * G );
			acc += liftDir * lift;

			// WIDERSTAND: gegen die Flugrichtung (induzierter Teil hängt vom echten Auftrieb ab)
			double clEff = lift / Max( qd, 1e-3 );
			double cd = CD0 - 0.018 * Fold + K_INDUCED * clEff * clEff;
			if ( Braking ) cd += BRAKE_CD;
			if ( airSpeed > 120.0 )
			{
				double over = (airSpeed - 120.0) / 40.0;
				cd += over * over * 0.05; // Höchstgeschwindigkeit
			}
			acc += dir * (-qd * cd);

			// SEITENKRAFT: verhindert seitliches Rutschen (Körper + Schwanz)
			double side = DVec3.Dot( air, r );
			acc += r * (-side * (0.4 + airSpeed * 0.02));
		}

		// SCHUB 1: Flügelschlag (pulsierend, synchron zur Animation)
		// Flughilfe: langsam → von selbst flattern; langsam hochziehen → kräftig flattern
		bool climbFlap = env.Assist && !input.Dive && input.Pitch > 0.3 && airSpeed < 32.0;
		bool autoFlap = (env.Assist && airSpeed < 16.0 && !input.Dive) || climbFlap;
		bool flapping = input.Flap || Boosting || autoFlap;
		double targetAmp = (input.Flap || Boosting) ? 1.0 : (climbFlap ? 0.9 : (autoFlap ? 0.6 : 0.0));
		FlapAmp = Damp( FlapAmp, targetAmp, 4.0, dt );
		if ( flapping || FlapAmp > 0.05 )
		{
			double prev = FlapPhase;
			FlapPhase = (FlapPhase + dt * (Boosting ? FLAP_FREQ_FAST : FLAP_FREQ)) % 1.0;
			if ( FlapPhase < prev && FlapAmp > 0.3 ) OnFlap?.Invoke( FlapAmp );
		}
		if ( FlapAmp > 0.01 )
		{
			// Nur der Abschlag (Phase 0–0.5) drückt richtig. Mittelwert der Formel = 1.
			double stroke = 0.4 + 0.6 * (Max( 0.0, Math.Sin( FlapPhase * PI * 2.0 ) ) / 0.318);
			// Beim steilen Steigen wird Flattern immer weniger wirksam (kein "Raketen-Drache")
			double climb = Clamp( 1.0 - (Velocity.Y - 6.0) / 10.0, 0.15, 1.0 );
			double fwdThrust = (7.0 * Max( 0.0, 1.0 - airSpeed / 60.0 ) + 1.2) * climb;
			double upThrust = (4.0 + 6.0 * Max( 0.0, 1.0 - airSpeed / 35.0 )) * climb;
			acc += f * (fwdThrust * stroke * FlapAmp * density);
			// Hub zeigt überwiegend nach OBEN (Welt) – sonst würde Dauer-Flattern einen Looping machen
			DVec3 liftUp = Normalized( u + (PS_UP - u) * 0.7 );
			acc += liftUp * (upThrust * stroke * FlapAmp * density);
		}

		// SCHUB 2: Boost (verbraucht Ausdauer)
		if ( Boosting ) acc += f * (BOOST_ACC * Max( 0.0, 1.0 - airSpeed / 110.0 ) + 3.0);

		// Turbulenz bei Sturm
		if ( env.Turbulence > 0.0 )
		{
			double t = env.Turbulence * 5.0;
			acc.X += (Rand() - 0.5) * t;
			acc.Y += (Rand() - 0.5) * t;
			acc.Z += (Rand() - 0.5) * t;
		}

		// Kartenrand: sanft zurück zur Mitte lenken
		double dist = Math.Sqrt( Position.X * Position.X + Position.Z * Position.Z );
		OutOfBounds = Clamp( (dist - WorldRadius) / 300.0, 0.0, 1.0 );
		if ( dist > WorldRadius )
		{
			acc += new DVec3( -Position.X / dist, 0.0, -Position.Z / dist ) * ((dist - WorldRadius) * 0.06);
			// auch die Nase Richtung Mitte drehen
			double want = Math.Atan2( Position.X, Position.Z );
			double d = AngleDiff( heading, want );
			Rotation = DQuat.FromAxisAngle( PS_UP, d * dt * 0.8 * OutOfBounds ) * Rotation;
		}
		// Höhen-Decke
		if ( Position.Y > 2600.0 ) acc.Y -= (Position.Y - 2600.0) * 0.1;

		// ---------- 4) BEWEGEN ----------
		Velocity += acc * dt;
		Position += Velocity * dt;

		Collide( dt, env );
	}

	// ---------------------------------------------------------------------------
	// Schweben: Der Drache steht fast senkrecht in der Luft und schlägt kräftig.
	void HoverStep( double dt, DragonFlightInput input, DragonFlightEnv env )
	{
		Fold = Damp( Fold, 0.0, 5.0, dt );
		FlapAmp = Damp( FlapAmp, 1.0, 4.0, dt );
		double prev = FlapPhase;
		FlapPhase = (FlapPhase + dt * 2.1) % 1.0;
		if ( FlapPhase < prev ) OnFlap?.Invoke( 0.9 );

		// Gieren mit A/D (auf der Stelle drehen)
		DVec3 f = Forward;
		double h = Math.Atan2( -f.X, -f.Z );
		h -= input.Roll * 1.3 * dt;
		// Zielhaltung: Nase 22° hoch, keine Schräglage (JS: Euler YXZ = erst gieren, dann nicken).
		// Landen: je schneller noch, desto steiler aufrichten (Flügel bremsen wie bei einem Adler)
		bool land = input.Land;
		double move = land ? 0.0 : input.Move;
		double hs = Math.Sqrt( Velocity.X * Velocity.X + Velocity.Z * Velocity.Z );
		double flare = land ? Min( hs / 30.0, 1.0 ) * 0.5 : 0.0;
		DQuat target = DQuat.FromAxisAngle( PS_UP, h ) * DQuat.FromAxisAngle( PS_RIGHT, 0.38 - move * 0.1 + flare );
		Rotation = DQuat.Slerp( Rotation, target, 1.0 - Math.Exp( -3.0 * dt ) );
		AngVel *= Math.Exp( -5.0 * dt );
		Bank = 0.0;

		// Gewünschte Geschwindigkeit: W vor, S zurück, Leertaste hoch, Shift runter
		var dir = new DVec3( -Math.Sin( h ), 0.0, -Math.Cos( h ) );
		DVec3 want = dir * (move * (move > 0.0 ? 12.0 : 6.0));
		want.Y = (input.Flap ? 9.0 : 0.0) - (input.Dive ? 9.0 : 0.0);
		if ( land )
		{
			// hoch oben schnell sinken, kurz vor dem Boden ganz sanft
			double above = Position.Y - Max( env.World.GroundHeight( Position.X, Position.Z ), WATER_LEVEL ) - STAND_HEIGHT;
			want.Y = -Clamp( above * 0.8, 2.5, 20.0 );
		}
		want += env.Wind * 0.25;
		double k = 1.0 - Math.Exp( -1.8 * dt );
		Velocity.X += (want.X - Velocity.X) * k;
		Velocity.Y += (want.Y - Velocity.Y) * k;
		Velocity.Z += (want.Z - Velocity.Z) * k;
		Position += Velocity * dt;
	}

	// ---------------------------------------------------------------------------
	// Am Boden: gehen, drehen, mit Leertaste abheben
	void GroundStep( double dt, DragonFlightInput input, DragonFlightEnv env )
	{
		Hovering = false;
		Braking = false;
		Fold = Damp( Fold, 0.0, 5.0, dt );
		FlapAmp = Damp( FlapAmp, 0.0, 5.0, dt );
		DVec3 f = Forward;
		double h = Math.Atan2( -f.X, -f.Z );
		// W vorwärts, S rückwärts, mit Boost rennen. Beim Rennen dreht der Drache weniger eng.
		double move = input.Move;
		bool run = input.Boost && move > 0.1;
		h -= input.Roll * (run ? 1.1 : 1.7) * dt;
		double target = move > 0.1 ? move * (run ? WALK_RUN : WALK_SPEED) : (move < -0.1 ? move * 3.0 : 0.0);
		WalkSpeed = Damp( WalkSpeed, target, 4.0, dt );
		double hx = -Math.Sin( h );
		double hz = -Math.Cos( h );
		Position.X += hx * WalkSpeed * dt;
		Position.Z += hz * WalkSpeed * dt;
		double gh = env.World.GroundHeight( Position.X, Position.Z );
		OnWater = gh < WATER_LEVEL;
		double surface = Max( gh, WATER_LEVEL );
		double standY = surface + (OnWater ? STAND_HEIGHT * 0.45 : STAND_HEIGHT);
		Position.Y = Damp( Position.Y, standY, 10.0, dt );
		Velocity = new DVec3( hx * WalkSpeed, 0.0, hz * WalkSpeed );

		// Körper an den Boden anpassen (Hang)
		DVec3 n = OnWater ? PS_UP : env.World.GroundNormal( Position.X, Position.Z );
		var ahead = new DVec3( hx, 0.0, hz );
		DVec3 r = Normalized( DVec3.Cross( ahead, n ) );   // rechts
		DVec3 fwd = Normalized( DVec3.Cross( n, r ) );     // vorne, parallel zum Hang
		DQuat target2 = QuatFromBasis( r, n, -fwd );       // lokal −Z = vorne
		Rotation = DQuat.Slerp( Rotation, target2, 1.0 - Math.Exp( -6.0 * dt ) );

		Collide( dt, env );

		// Abheben!
		if ( input.FlapPressed || (input.Flap && Stamina > 0.05) )
		{
			Grounded = false;
			Velocity = ahead * 14.0 + new DVec3( 0.0, 13.0, 0.0 );
			FlapAmp = 1.0;
			FlapPhase = 0.0;
			OnTakeoff?.Invoke();
			OnFlap?.Invoke( 1.2 );
		}
	}

	// ---------------------------------------------------------------------------
	// Boden, Wasser und Hindernisse
	void Collide( double dt, DragonFlightEnv env )
	{
		double gh = env.World.GroundHeight( Position.X, Position.Z );
		bool water = gh < WATER_LEVEL;
		double surface = Max( gh, WATER_LEVEL );
		double minY = surface + (water ? STAND_HEIGHT * 0.45 : STAND_HEIGHT);

		if ( !Grounded && Position.Y < minY )
		{
			DVec3 n = water ? PS_UP : env.World.GroundNormal( Position.X, Position.Z );
			double into = -DVec3.Dot( Velocity, n ); // wie schnell geht es "in den Boden"?
			Position.Y = minY;
			double spd = Velocity.Length;
			if ( water && into > 2.0 ) OnSplash?.Invoke( Clamp( spd / 50.0, 0.3, 1.5 ) );
			if ( into > 14.0 && spd > 20.0 )
			{
				// harter Aufprall → abprallen
				Velocity += n * (into * 1.35);
				Velocity *= 0.55;
				Stamina = Max( 0.0, Stamina - 0.2 );
				OnImpact?.Invoke( Clamp( into / 30.0, 0.3, 1.5 ), water );
			}
			else if ( into > 0.0 )
			{
				// weich: Geschwindigkeit in den Boden entfernen, Reibung
				Velocity += n * into;
				Velocity *= Math.Exp( -(water ? 1.5 : 1.0) * dt );
				double horiz = Math.Sqrt( Velocity.X * Velocity.X + Velocity.Z * Velocity.Z );
				if ( horiz < 14.0 && !Hovering )
				{
					Grounded = true;
					WalkSpeed = 0.0;
					Velocity = DVec3.Zero;
					OnLand?.Invoke( water, into );
				}
			}
			if ( Hovering && Position.Y <= minY + 0.01 && Velocity.Y <= 0.1 )
			{
				Hovering = false;
				Grounded = true;
				OnLand?.Invoke( water, 2.0 );
			}
		}

		// Gebäude & Felsen
		for ( int i = 0; i < 3; i++ )
		{
			double depth = env.World.TestObstacles( Position, BODY_RADIUS, out DVec3 n );
			if ( depth <= 0.0 ) break;
			Position += n * depth;
			double vn = DVec3.Dot( Velocity, n );
			if ( vn < 0.0 )
			{
				Velocity += n * (-vn * 1.25);
				if ( -vn > 18.0 )
				{
					Velocity *= 0.7;
					Stamina = Max( 0.0, Stamina - 0.15 );
					OnImpact?.Invoke( Clamp( -vn / 35.0, 0.3, 1.4 ), false );
				}
			}
		}
	}

	// ---------------------------------------------------------------------------
	/** Zustand für die Animation */
	public DragonAnimState GetAnimState() => new()
	{
		FlapPhase = FlapPhase,
		FlapAmp = FlapAmp,
		Fold = Fold,
		Bank = Bank,
		PitchRate = AngVel.X,
		YawRate = YawRate,
		Roll = lastInput.Roll,
		Speed = Speed,
		Agl = Agl,
		Hover = (Hovering || Frozen) ? 1.0 : 0.0,
		Grounded = Grounded ? 1.0 : 0.0,
		Walk = Grounded ? Min( 1.0, Math.Abs( WalkSpeed ) / 6.0 ) : 0.0,
		Boost = Boosting,
	};
}
