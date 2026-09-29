// =====================================================================
//  DER DRACHE IN S&BOX – Steuerung, Kamera, Boden
// =====================================================================
// Diese Komponente kommt auf das GameObject "Drache" (das Modell hängt als Kind darunter).
// Sie liest die Tasten, rechnet die Flugphysik (Flight/DragonFlightModel.cs, gleiche Zahlen wie
// im Browser-Spiel) und setzt Position + Drehung. Dazu eine Verfolger-Kamera und eine kleine Anzeige.
//
// Boden: ein Strahl (Trace) senkrecht nach unten findet die Bodenhöhe. Der Drache selbst wird dabei
// ignoriert. Hindernisse (Häuser, Felsen) kommen später – im Moment fliegt man durch sie hindurch.
//
// ACHTUNG: Dieser Teil wurde NICHT mit s&box kompiliert (in der Cloud gibt es kein s&box).
// Die Flugphysik selbst ist getestet (sbox/Tests/). Bei s&box-Namen, die sich geändert haben
// (z. B. DebugOverlay, Trace), zeigt s&box einen Fehler an → dort anpassen.
// =====================================================================
using System;
using DragonFlight;
using Sandbox;

[Title( "Drache (Flug-Steuerung)" )]
[Category( "DragonTwin" )]
[Icon( "flight" )]
public sealed class DragonController : Component
{
	// ---------------- Einstellungen (im Editor änderbar) ----------------
	/** Tempo beim Start (m/s). 0 = steht (dann fällt er, bis er den Boden findet). */
	[Property, Group( "Flug" )] public float StartSpeed { get; set; } = 35f;

	/** Flughilfe: hält die Höhe, begrenzt die Schräglage (wie im Browser-Spiel, Standard an) */
	[Property, Group( "Flug" )] public bool FlightAssist { get; set; } = true;

	/** Flugzeug-Steuerung: W = Nase runter, S = Nase hoch (Standard aus: W = hoch) */
	[Property, Group( "Flug" )] public bool InvertPitch { get; set; } = false;

	/** Ab dieser Entfernung von der Mitte (m) wird man sanft zurückgelenkt */
	[Property, Group( "Flug" )] public float WorldRadius { get; set; } = 2850f;

	/** Kamera (leer = Haupt-Kamera der Szene) */
	[Property, Group( "Kamera" )] public CameraComponent ChaseCamera { get; set; }

	/** Abstand hinter dem Drachen (m) */
	[Property, Group( "Kamera" )] public float CameraDistance { get; set; } = 26f;

	/** Höhe über dem Drachen (m) */
	[Property, Group( "Kamera" )] public float CameraHeight { get; set; } = 6f;

	[Property, Group( "Kamera" )] public float CameraFieldOfView { get; set; } = 75f;

	// Namen der Tasten-Aktionen (Projekt-Einstellungen → Input). W/S/A/D kommen aus "AnalogMove".
	[Property, Group( "Tasten" )] public string FlapAction { get; set; } = "Jump";   // Leertaste
	[Property, Group( "Tasten" )] public string DiveAction { get; set; } = "Run";    // Shift
	[Property, Group( "Tasten" )] public string BoostAction { get; set; } = "Boost"; // E
	[Property, Group( "Tasten" )] public string HoverAction { get; set; } = "Hover"; // V
	[Property, Group( "Tasten" )] public string LandAction { get; set; } = "Land";   // L

	/** Anzeige oben links (Tempo, Höhe, Ausdauer) */
	[Property] public bool ShowFlightInfo { get; set; } = true;

	/** Die Flugphysik (Physik-Raum: Meter, Y oben, −Z vorne) */
	public DragonFlightModel Flight { get; } = new();

	/** Die Welt aus Sicht der Flugphysik (Boden per Trace) – auch für Gegner-Drachen */
	public IDragonFlightWorld World => world;

	/** Nach jedem Physik-Schritt: (Position vorher, dt). Das Ringrennen hängt sich hier an. */
	public Action<DVec3, double> AfterFlightUpdate;

	const double LandMaxAgl = 150.0; // so hoch darf man höchstens sein, um mit L zu landen (m)

	SceneFlightWorld world;
	double keyPitch;
	double keyRoll;
	bool flapWasDown;
	bool landWasDown;
	bool landing;
	DVec3 camPos;
	bool camReady;
	string message = "";
	double messageTime;

	// ---------------------------------------------------------------------------
	protected override void OnStart()
	{
		world = new SceneFlightWorld( Scene, GameObject );

		// Startpunkt und Blickrichtung aus der Szene übernehmen
		Vector3 fwd = WorldRotation.Forward;
		double heading = DragonSpace.HeadingFromSboxForward( new DVec3( fwd.x, fwd.y, fwd.z ) );
		Vector3 p = WorldPosition;
		Flight.WorldRadius = WorldRadius;
		Flight.Reset( DragonSpace.ToPhysics( new DVec3( p.x, p.y, p.z ) ), heading, StartSpeed );

		// Ereignisse: vorerst nur als Meldung (Töne, Staub und Kamera-Wackeln kommen später)
		Flight.OnLand = ( water, _ ) => Say( water ? "Auf dem Wasser gelandet" : "Gelandet" );
		Flight.OnTakeoff = () => Say( "Abgehoben" );
		Flight.OnImpact = ( strength, _ ) => Say( $"Aufprall! (Stärke {strength:0.0})" );
		Flight.OnSplash = _ => Say( "Platsch!" );
	}

	protected override void OnUpdate()
	{
		if ( world == null ) return;
		double dt = Time.Delta;

		var env = new DragonFlightEnv
		{
			World = world,
			Wind = DVec3.Zero,
			Assist = FlightAssist,
			Turbulence = 0.0,
		};
		Flight.WorldRadius = WorldRadius;
		DVec3 prevPos = Flight.Position;
		Flight.Update( dt, ReadInput( dt ), env );
		AfterFlightUpdate?.Invoke( prevPos, dt );

		// Physik-Raum → s&box
		WorldPosition = ToVector( DragonSpace.ToSbox( Flight.Position ) );
		DQuat q = DragonSpace.QuatToSbox( Flight.Rotation );
		WorldRotation = new Rotation( (float)q.X, (float)q.Y, (float)q.Z, (float)q.W );

		UpdateCamera( dt );
		if ( ShowFlightInfo ) DrawFlightInfo( dt );
	}

	// ---------------------------------------------------------------------------
	// Eingaben: gleiche Tasten wie im Browser-Spiel
	DragonFlightInput ReadInput( double dt )
	{
		var inp = new DragonFlightInput();
		// AnalogMove: x = vorne (W / Stick vor), y = links (A / Stick links)
		Vector3 move = Input.AnalogMove;
		// Tastatur-Achsen weich hochfahren (≈ 0.1 s) und schneller zurück – wie src/core/Input.js
		keyPitch = Approach( keyPitch, Math.Clamp( move.x, -1.0, 1.0 ), dt );
		keyRoll = Approach( keyRoll, Math.Clamp( -move.y, -1.0, 1.0 ), dt );
		inp.Move = keyPitch;                              // am Boden / beim Schweben: W = vorwärts
		inp.Pitch = InvertPitch ? -keyPitch : keyPitch;   // im Flug: W = Nase hoch
		inp.Roll = keyRoll;                               // D = rechts
		inp.Flap = Input.Down( FlapAction );
		inp.FlapPressed = inp.Flap && !flapWasDown;
		flapWasDown = inp.Flap;
		inp.Dive = Input.Down( DiveAction );
		inp.Boost = Input.Down( BoostAction );
		inp.Hover = Input.Down( HoverAction );

		// Landen (L): Landeanflug bis zum Boden. Abbrechen: L nochmal, Flügelschlag oder Boost.
		if ( Flight.Grounded ) landing = false;
		bool landDown = Input.Down( LandAction );
		if ( landDown && !landWasDown )
		{
			if ( Flight.Grounded ) Say( "Du stehst schon am Boden – Abheben mit Leertaste" );
			else if ( landing )
			{
				landing = false;
				Say( "Landung abgebrochen" );
			}
			else if ( Flight.Agl > LandMaxAgl ) Say( $"Zu hoch zum Landen – flieg tiefer als {LandMaxAgl:0} m" );
			else
			{
				landing = true;
				Say( "Landeanflug – abbrechen mit Leertaste" );
			}
		}
		landWasDown = landDown;
		if ( landing && (inp.FlapPressed || inp.Boost) ) landing = false;
		inp.Land = landing;
		return inp;
	}

	static double Approach( double cur, double target, double dt )
	{
		double rate = (target == 0.0 || Math.Sign( target ) != Math.Sign( cur )) ? 14.0 : 10.0;
		double d = target - cur;
		double step = rate * dt;
		return Math.Abs( d ) <= step ? target : cur + Math.Sign( d ) * step;
	}

	// ---------------------------------------------------------------------------
	// Verfolger-Kamera: hinter dem Drachen (in Flugrichtung), leicht erhöht, weich nachgezogen.
	// Gerechnet im Physik-Raum (Meter), erst am Ende nach s&box umgerechnet.
	void UpdateCamera( double dt )
	{
		CameraComponent cam = ChaseCamera ?? Scene.Camera;
		if ( cam == null ) return;

		DVec3 pos = Flight.Position;
		DVec3 dir = (!Flight.Grounded && Flight.Speed > 3.0) ? Flight.Velocity : Flight.Forward;
		dir.Y = 0.0;
		if ( dir.LengthSquared < 1e-6 )
		{
			dir = Flight.Forward;
			dir.Y = 0.0;
		}
		dir = dir.SafeNormal();
		if ( dir.LengthSquared < 0.5 ) dir = new DVec3( 0.0, 0.0, -1.0 );

		DVec3 want = pos - dir * CameraDistance + new DVec3( 0.0, CameraHeight, 0.0 );
		if ( !camReady )
		{
			camPos = want;
			camReady = true;
		}
		camPos = camPos + (want - camPos) * (1.0 - Math.Exp( -8.0 * dt ));
		// nicht unter den Boden
		double minY = Math.Max( world.GroundHeight( camPos.X, camPos.Z ), DragonFlightModel.WATER_LEVEL ) + 2.0;
		if ( camPos.Y < minY ) camPos.Y = minY;

		DVec3 look = pos + new DVec3( 0.0, 2.0, 0.0 ) - camPos;
		cam.WorldPosition = ToVector( DragonSpace.ToSbox( camPos ) );
		cam.WorldRotation = Rotation.LookAt( ToVector( DragonSpace.DirToSbox( look ) ), Vector3.Up );
		cam.FieldOfView = CameraFieldOfView;
	}

	/** Kamera sofort hinter den Drachen setzen (z. B. nach einem Sprung an den Rennstart) */
	public void SnapCamera() => camReady = false;

	/** Kurze Meldung oben links (2,5 s) */
	public void Say( string text )
	{
		message = text;
		messageTime = 2.5;
		Log.Info( $"Drache: {text}" );
	}

	// ---------------------------------------------------------------------------
	void DrawFlightInfo( double dt )
	{
		string mode = Flight.Grounded ? "am Boden"
			: landing ? "landet"
			: Flight.Hovering ? "schwebt"
			: Flight.Boosting ? "Boost"
			: Flight.Fold > 0.5 ? "Sturzflug"
			: Flight.Speed < 14.0 ? "zu langsam!"
			: "fliegt";
		string text = $"Tempo {Flight.Speed * 3.6:0} km/h   Höhe {Flight.Agl:0} m   Ausdauer {Flight.Stamina * 100.0:0} %   {mode}";
		DebugOverlay.ScreenText( new Vector2( 20, 20 ), text, 18 );
		if ( messageTime > 0.0 )
		{
			messageTime -= dt;
			DebugOverlay.ScreenText( new Vector2( 20, 48 ), message, 18 );
		}
	}

	static Vector3 ToVector( DVec3 v ) => new( (float)v.X, (float)v.Y, (float)v.Z );
}

/**
 * Die Welt aus Sicht der Flugphysik: Bodenhöhe per Strahl (Trace) senkrecht nach unten.
 * Merkt sich die letzte Abfrage (die Physik fragt oft mehrmals dieselbe Stelle).
 */
sealed class SceneFlightWorld : IDragonFlightWorld
{
	readonly Scene scene;
	readonly GameObject self;
	double lastX = double.NaN;
	double lastZ = double.NaN;
	double height;
	DVec3 normal = new( 0.0, 1.0, 0.0 );

	public SceneFlightWorld( Scene scene, GameObject self )
	{
		this.scene = scene;
		this.self = self;
	}

	void Query( double x, double z )
	{
		if ( x == lastX && z == lastZ ) return;
		lastX = x;
		lastZ = z;
		DVec3 spot = DragonSpace.ToSbox( new DVec3( x, 0.0, z ) );
		const float Top = 400000f; // ≈ 10 km über dem Meer (in Zoll)
		var from = new Vector3( (float)spot.X, (float)spot.Y, Top );
		var to = new Vector3( (float)spot.X, (float)spot.Y, -Top );
		var tr = scene.Trace.Ray( from, to ).IgnoreGameObjectHierarchy( self ).Run();
		if ( tr.Hit )
		{
			height = tr.EndPosition.z / DragonSpace.UnitsPerMeter;
			Vector3 n = tr.Normal;
			normal = DragonSpace.DirToPhysics( new DVec3( n.x, n.y, n.z ) ).SafeNormal();
			if ( normal.Y < 0.05 ) normal = new DVec3( 0.0, 1.0, 0.0 ); // senkrechte Wand: wie flach behandeln
		}
		else
		{
			height = -1000.0; // kein Boden gefunden → wie tiefes Wasser
			normal = new DVec3( 0.0, 1.0, 0.0 );
		}
	}

	public double GroundHeight( double x, double z )
	{
		Query( x, z );
		return height;
	}

	public DVec3 GroundNormal( double x, double z )
	{
		Query( x, z );
		return normal;
	}

	public double TestObstacles( DVec3 pos, double radius, out DVec3 outNormal )
	{
		outNormal = DVec3.Zero;
		return 0.0; // kommt später (Häuser, Felsen)
	}
}
