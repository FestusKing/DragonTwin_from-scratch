// =====================================================================
//  RINGRENNEN IN S&BOX – Ringe, Gegner-Drachen, Geist, Anzeige, Bestzeiten
// =====================================================================
// Die Spiel-Logik steckt in Game/RingRace.cs (ohne s&box, getestet). Diese Komponente zeigt sie an:
//  - Ringe als Modell (models/ring.vmdl, aus sbox/Assets/models/ring.obj), eingefärbt je nach Zustand
//  - Gegner-Drachen und Geist: Kopien des Drachen-Modells (gleiche Drehung/Grösse wie beim Spieler)
//  - Anzeige: Countdown, Zeit, Ring x/y, Platz, Abstand zur Bestzeit, Ergebnis mit Medaille
//  - Bestzeit + Geist werden gespeichert (FileSystem.Data, pro Strecke eine Datei)
//
// Tasten (Namen der Aktionen einstellbar): R = Rennen starten/neu, 1/2/3 = Strecke,
// 4 = Gegner an/aus, 5 = Geist an/aus.
//
// ACHTUNG: Nicht mit echtem s&box kompiliert (nur gegen sbox/Tests/ControllerCheck/SboxStub.cs).
// =====================================================================
using System;
using System.Collections.Generic;
using DragonFlight;
using Sandbox;

[Title( "Ringrennen" )]
[Category( "DragonTwin" )]
[Icon( "flag" )]
public sealed class RaceComponent : Component
{
	/** Der Spieler-Drache */
	[Property] public DragonController Dragon { get; set; }

	/** Das Modell-Kind des Spieler-Drachen (mit SkinnedModelRenderer). Wird für Gegner und Geist kopiert. */
	[Property] public GameObject DragonModel { get; set; }

	/** Ring-Modell (leer = models/ring.vmdl) */
	[Property] public Model RingModel { get; set; }

	/** Anzahl Gegner-Drachen (0 = Zeitfahren allein, höchstens 3) */
	[Property] public int RivalCount { get; set; } = 3;

	/** Gegen den eigenen Geist (Bestzeit) fliegen */
	[Property] public bool UseGhost { get; set; } = true;

	[Property, Group( "Tasten" )] public string StartAction { get; set; } = "Reload";       // R
	[Property, Group( "Tasten" )] public string Course1Action { get; set; } = "Slot1";      // 1
	[Property, Group( "Tasten" )] public string Course2Action { get; set; } = "Slot2";      // 2
	[Property, Group( "Tasten" )] public string Course3Action { get; set; } = "Slot3";      // 3
	[Property, Group( "Tasten" )] public string RivalsAction { get; set; } = "Slot4";       // 4
	[Property, Group( "Tasten" )] public string GhostAction { get; set; } = "Slot5";        // 5

	// Farben wie im Browser-Spiel
	static readonly Color ColNext = new( 1.0f, 0.7f, 0.22f );
	static readonly Color ColUp = new( 0.3f, 0.75f, 1.0f );
	static readonly Color ColFar = new( 0.2f, 0.4f, 0.6f );
	static readonly Color ColFinish = new( 0.35f, 1.0f, 0.45f );
	static readonly Color[] ColRivals = { new( 0.95f, 0.45f, 0.15f ), new( 0.35f, 0.55f, 0.95f ), new( 0.55f, 0.95f, 0.6f ) };
	static readonly Color ColGhost = new( 0.8f, 0.9f, 1.0f, 0.35f );

	readonly RingRace race = new();
	readonly List<GameObject> rings = new();
	readonly List<ModelRenderer> ringRenderers = new();
	readonly List<float> ringScales = new();
	readonly List<GameObject> rivalObjects = new();
	GameObject ghostObject;
	int courseIndex;
	double pulse;
	string banner = "";
	double bannerTime;
	string splitText = "";
	double splitTime;

	// ---------------------------------------------------------------------------
	protected override void OnStart()
	{
		if ( Dragon == null ) return;
		Dragon.AfterFlightUpdate += OnFlightUpdated;

		race.OnCountdown = n => Banner( n.ToString(), 0.9 );
		race.OnGo = () => Banner( "LOS!", 1.2 );
		race.OnRing = ( i, n, t, delta ) =>
		{
			if ( i < n - 1 ) Banner( $"Ring {i + 1} / {n}", 0.8 );
			if ( delta.HasValue )
			{
				splitText = $"{(delta.Value <= 0 ? "−" : "+")}{Math.Abs( delta.Value ):0.00} s zur Bestzeit";
				splitTime = 2.0;
			}
		};
		race.OnFinish = r =>
		{
			string place = r.Racers > 1 ? $"  Platz {r.Place} von {r.Racers}" : "";
			string rec = r.IsRecord ? "  NEUE BESTZEIT!" : $"  (Bestzeit {RingRace.FormatTime( r.Best ?? 0 )} s)";
			Banner( $"ZIEL! {RingRace.FormatTime( r.Time )} s{place}  Medaille: {RingRace.MedalName( r.Medal )}{rec}", 8.0 );
		};
		race.OnRivalFinish = ( rival, place ) => Dragon.Say( $"{rival.Name} ist im Ziel (Platz {place})" );
		race.OnNewRecord = rec => SaveRecord( race.Course.Info.Id, rec );
	}

	protected override void OnDestroy()
	{
		if ( Dragon != null ) Dragon.AfterFlightUpdate -= OnFlightUpdated;
		ClearObjects();
	}

	/** Kommt vom DragonController direkt nach der Flugphysik */
	void OnFlightUpdated( DVec3 prevPos, double dt )
	{
		if ( race.State == RaceState.Idle ) return;
		// Gegner fliegen immer mit Flughilfe (dafür ist der Autopilot gemacht)
		var env = new DragonFlightEnv { World = Dragon.World, Wind = DVec3.Zero, Assist = true, Turbulence = 0.0 };
		race.Update( dt, Dragon.Flight, prevPos, env );
	}

	protected override void OnUpdate()
	{
		if ( Dragon == null ) return;
		double dt = Time.Delta;
		ReadKeys();
		UpdateRings( dt );
		UpdateRivalsAndGhost();
		DrawHud( dt );
	}

	// ---------------------------------------------------------------------------
	void ReadKeys()
	{
		if ( Input.Pressed( Course1Action ) ) SelectCourse( 0 );
		if ( Input.Pressed( Course2Action ) ) SelectCourse( 1 );
		if ( Input.Pressed( Course3Action ) ) SelectCourse( 2 );
		if ( Input.Pressed( RivalsAction ) )
		{
			RivalCount = RivalCount > 0 ? 0 : 3;
			Dragon.Say( RivalCount > 0 ? "Gegner: an (3 Drachen)" : "Gegner: aus (Zeitfahren)" );
		}
		if ( Input.Pressed( GhostAction ) )
		{
			UseGhost = !UseGhost;
			Dragon.Say( UseGhost ? "Geist: an" : "Geist: aus" );
		}
		if ( Input.Pressed( StartAction ) ) StartRace();
	}

	void SelectCourse( int index )
	{
		courseIndex = Math.Clamp( index, 0, RaceCourses.All.Length - 1 );
		var info = RaceCourses.All[courseIndex];
		race.Cancel( Dragon.Flight );
		ClearObjects();
		Banner( $"Strecke: {info.Name} ({info.Difficulty}) – R zum Starten", 3.0 );
	}

	void StartRace()
	{
		var info = RaceCourses.All[courseIndex];
		var course = RaceCourses.Build( info, Dragon.World );
		race.Load( course, LoadRecordCached( info.Id ), UseGhost, RivalCount );
		race.Begin( Dragon.Flight );
		Dragon.SnapCamera();
		CreateObjects();
		splitText = "";
	}

	// ---------------------------------------------------------------------------
	// Ringe, Gegner und Geist als Objekte in der Szene
	void CreateObjects()
	{
		ClearObjects();
		Model ring = RingModel ?? Model.Load( "models/ring.vmdl" );
		// Radius des Modells (in s&box-Einheiten) → damit der Ring genau den Radius aus der Strecke hat.
		// ring.obj: Ring-Radius 1, Rohr-Radius 0.06 → Aussenmass = 2 · 1.06
		double modelRadius = ring != null ? Math.Max( ring.Bounds.Size.y, ring.Bounds.Size.z ) * 0.5 / 1.06 : 1.0;
		if ( modelRadius < 1e-3 ) modelRadius = 1.0;
		for ( int i = 0; i < race.Course.Rings.Count; i++ )
		{
			RaceRing r = race.Course.Rings[i];
			GameObject go = Scene.CreateObject();
			go.Name = $"Ring {i + 1}";
			var mr = go.Components.Create<ModelRenderer>();
			mr.Model = ring;
			go.WorldPosition = ToVector( DragonSpace.ToSbox( r.Pos ) );
			go.WorldRotation = Rotation.LookAt( ToVector( DragonSpace.DirToSbox( r.Normal ) ), Vector3.Up ); // Ring-Achse = lokal +X
			float scale = (float)(r.Radius * DragonSpace.UnitsPerMeter / modelRadius);
			go.WorldScale = new Vector3( scale, scale, scale );
			rings.Add( go );
			ringRenderers.Add( mr );
			ringScales.Add( scale );
		}
		for ( int i = 0; i < race.Rivals.Count; i++ )
		{
			GameObject go = CreateDragonCopy( $"Gegner {race.Rivals[i].Name}", ColRivals[i % ColRivals.Length] );
			if ( go != null ) rivalObjects.Add( go );
		}
		if ( race.Ghost != null ) ghostObject = CreateDragonCopy( "Geist", ColGhost );
	}

	/** Kopie des Drachen-Modells (gleiches Modell, eigene Farbe) */
	GameObject CreateDragonCopy( string name, Color tint )
	{
		if ( DragonModel == null ) return null;
		var src = DragonModel.GetComponent<SkinnedModelRenderer>();
		if ( src == null ) return null;
		GameObject go = Scene.CreateObject();
		go.Name = name;
		var mr = go.Components.Create<SkinnedModelRenderer>();
		mr.Model = src.Model;
		mr.Tint = tint;
		return go;
	}

	void ClearObjects()
	{
		foreach ( var go in rings ) go?.Destroy();
		foreach ( var go in rivalObjects ) go?.Destroy();
		ghostObject?.Destroy();
		rings.Clear();
		ringRenderers.Clear();
		ringScales.Clear();
		rivalObjects.Clear();
		ghostObject = null;
	}

	/** Ein Drachen-Modell an eine Stelle der Physik setzen – mit derselben Verschiebung/Drehung wie beim Spieler */
	void PlaceDragon( GameObject go, DVec3 pos, DQuat rot )
	{
		if ( go == null || DragonModel == null ) return;
		DQuat q = DragonSpace.QuatToSbox( rot );
		var body = new Rotation( (float)q.X, (float)q.Y, (float)q.Z, (float)q.W );
		go.WorldRotation = body * DragonModel.LocalRotation;
		go.WorldPosition = ToVector( DragonSpace.ToSbox( pos ) ) + body * DragonModel.LocalPosition;
		go.WorldScale = DragonModel.LocalScale;
	}

	void UpdateRivalsAndGhost()
	{
		for ( int i = 0; i < rivalObjects.Count && i < race.Rivals.Count; i++ )
		{
			var f = race.Rivals[i].Flight;
			PlaceDragon( rivalObjects[i], f.Position, f.Rotation );
		}
		if ( ghostObject != null && race.Ghost != null )
		{
			bool running = race.State == RaceState.Running;
			bool alive = race.Ghost.Sample( running ? race.Time : 0.0, out DVec3 gp, out DQuat gq, out _, out _, out _ );
			ghostObject.Enabled = running && alive;
			if ( ghostObject.Enabled ) PlaceDragon( ghostObject, gp, gq );
		}
	}

	void UpdateRings( double dt )
	{
		if ( race.Course == null || rings.Count == 0 ) return;
		pulse += dt;
		int n = rings.Count;
		for ( int i = 0; i < n; i++ )
		{
			bool isNext = i == race.Next && race.State != RaceState.Finished;
			bool passed = i < race.Next;
			rings[i].Enabled = !passed;
			if ( passed ) continue;
			ringRenderers[i].Tint = isNext ? (i == n - 1 ? ColFinish : ColNext) : (i <= race.Next + 3 ? ColUp : ColFar);
			// der nächste Ring pulsiert leicht
			float k = ringScales[i] * (isNext ? (float)(1.0 + Math.Sin( pulse * 4.0 ) * 0.04) : 1f);
			rings[i].WorldScale = new Vector3( k, k, k );
		}
	}

	// ---------------------------------------------------------------------------
	// Anzeige (vorerst einfache Text-Zeilen; später eine schöne Oberfläche mit Razor)
	void DrawHud( double dt )
	{
		const float X = 20f;
		float y = 80f;
		var info = RaceCourses.All[courseIndex];
		switch ( race.State )
		{
			case RaceState.Idle:
			{
				RaceRecord best = LoadRecordCached( info.Id );
				string bestText = best != null ? $"Bestzeit {RingRace.FormatTime( best.Time )} s" : "noch keine Bestzeit";
				DebugOverlay.ScreenText( new Vector2( X, y ), $"Ringrennen: {info.Name} ({info.Difficulty}) – {bestText}", 18 );
				DebugOverlay.ScreenText( new Vector2( X, y + 24 ), "R = starten   1/2/3 = Strecke   " +
					$"4 = Gegner ({(RivalCount > 0 ? "an" : "aus")})   5 = Geist ({(UseGhost ? "an" : "aus")})", 16 );
				break;
			}
			case RaceState.Countdown:
				DebugOverlay.ScreenText( new Vector2( X, y ), $"{info.Name} – gleich geht's los!", 18 );
				break;
			case RaceState.Running:
			{
				int n = race.Course.Rings.Count;
				string place = race.Rivals.Count > 0 ? $"   Platz {race.CurrentPlace( Dragon.Flight )} / {race.Rivals.Count + 1}" : "";
				DebugOverlay.ScreenText( new Vector2( X, y ), $"Zeit {RingRace.FormatTime( race.Time )} s   Ring {race.Next + 1} / {n}{place}", 22 );
				RaceRing next = race.NextRing;
				if ( next != null ) DebugOverlay.ScreenText( new Vector2( X, y + 28 ), NextRingHint( next ), 18 );
				break;
			}
			case RaceState.Finished:
				DebugOverlay.ScreenText( new Vector2( X, y ), "R = nochmal   1/2/3 = andere Strecke", 16 );
				break;
		}
		if ( splitTime > 0.0 )
		{
			splitTime -= dt;
			DebugOverlay.ScreenText( new Vector2( X, y + 56 ), splitText, 20 );
		}
		if ( bannerTime > 0.0 )
		{
			bannerTime -= dt;
			DebugOverlay.ScreenText( new Vector2( X, y + 90 ), banner, 34 );
		}
	}

	/** "Nächster Ring: 230 m, links oben" – relativ zur Flugrichtung */
	string NextRingHint( RaceRing r )
	{
		var f = Dragon.Flight;
		DVec3 to = r.Pos - f.Position;
		double dist = to.Length;
		DVec3 fwd = f.Forward;
		DVec3 right = f.Right;
		double side = DVec3.Dot( to, right );
		double ahead = DVec3.Dot( to, fwd );
		string dir = "";
		if ( ahead < 0 ) dir = "hinter dir, ";
		if ( Math.Abs( side ) > dist * 0.25 ) dir += side > 0 ? "rechts " : "links ";
		if ( Math.Abs( to.Y ) > dist * 0.2 ) dir += to.Y > 0 ? "oben" : "unten";
		if ( dir.Length == 0 ) dir = "geradeaus";
		return $"Nächster Ring: {dist:0} m, {dir.Trim().TrimEnd( ',' )}";
	}

	void Banner( string text, double seconds )
	{
		banner = text;
		bannerTime = seconds;
	}

	// ---------------------------------------------------------------------------
	// Bestzeiten speichern (pro Strecke eine Datei im Daten-Ordner des Spiels)
	readonly Dictionary<string, RaceRecord> recordCache = new();

	static string RecordFile( string courseId ) => $"rennen_{courseId}.json";

	RaceRecord LoadRecordCached( string courseId )
	{
		if ( !recordCache.ContainsKey( courseId ) ) recordCache[courseId] = LoadRecord( courseId );
		return recordCache[courseId];
	}

	RaceRecord LoadRecord( string courseId )
	{
		try
		{
			string file = RecordFile( courseId );
			if ( !FileSystem.Data.FileExists( file ) ) return null;
			return FileSystem.Data.ReadJson<RaceRecord>( file );
		}
		catch ( Exception e )
		{
			Log.Warning( $"Bestzeit konnte nicht geladen werden: {e.Message}" );
			return null;
		}
	}

	void SaveRecord( string courseId, RaceRecord rec )
	{
		recordCache[courseId] = rec;
		try
		{
			FileSystem.Data.WriteJson( RecordFile( courseId ), rec );
		}
		catch ( Exception e )
		{
			Log.Warning( $"Bestzeit konnte nicht gespeichert werden: {e.Message}" );
		}
	}

	static Vector3 ToVector( DVec3 v ) => new( (float)v.X, (float)v.Y, (float)v.Z );
}
