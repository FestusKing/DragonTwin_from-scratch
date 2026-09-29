// NUR FÜR DEN TEST (nicht nach s&box kopieren!)
// Prüft das Ringrennen (Code/Game/) ohne s&box:
//  1) Ring-Treffer (durch den Ring, daneben, zu weit weg)
//  2) Jede Strecke ist fliegbar: Der Autopilot fliegt sie ab (flacher Boden und welliges Gelände),
//     ohne Aufprall und ohne Landung, in höchstens 5 Minuten.
//  3) Bestzeit + Geist: zweites Rennen gegen den Geist (Zwischenzeiten, Geist-Bahn).
using System;
using DragonFlight;

static class RaceTest
{
	static int fails;

	static void Check( bool ok, string what )
	{
		Console.WriteLine( (ok ? "  ok   " : "FEHLER ") + what );
		if ( !ok ) fails++;
	}

	public static bool Run()
	{
		Console.WriteLine( "\nRingrennen" );
		var ring = new RaceRing { Pos = new DVec3( 0, 50, -100 ), Normal = new DVec3( 0, 0, -1 ), Radius = 14 };
		Check( RingRace.Crossed( new DVec3( 3, 52, -99 ), new DVec3( 3, 52, -101 ), ring ), "durch den Ring = Treffer" );
		Check( !RingRace.Crossed( new DVec3( 20, 50, -99 ), new DVec3( 20, 50, -101 ), ring ), "20 m neben der Mitte = kein Treffer" );
		Check( !RingRace.Crossed( new DVec3( 0, 50, -90 ), new DVec3( 0, 50, -95 ), ring ), "noch vor dem Ring = kein Treffer" );
		Check( RingRace.Crossed( new DVec3( 0, 50, -101 ), new DVec3( 0, 50, -99 ), ring ), "auch rückwärts durch = Treffer (wie im Browser-Spiel)" );

		Console.WriteLine( "\nStrecke        Gelände  Ringe  Länge   Zeit (Autopilot)  Medaille        Gold / Silber / Bronze   Ergebnis" );
		foreach ( var info in RaceCourses.All )
		{
			foreach ( string terrain in new[] { "flach", "wellig" } )
			{
				var world = new TestWorld { Terrain = terrain, FlatH = 0.0 };
				var course = RaceCourses.Build( info, world );
				var r = Fly( course, world, null, false, out int impacts, out bool landed, out double minAgl );
				bool ok = r != null && impacts == 0 && !landed;
				string res = r == null ? "nicht im Ziel" : $"{RingRace.FormatTime( r.Time ),8} s";
				Console.WriteLine(
					$"{info.Name,-14} {terrain,-7}  {course.Rings.Count,5}  {course.Length,5:0} m  {res,-17} {(r == null ? "-" : RingRace.MedalName( r.Medal )),-15} " +
					$"{course.Gold,5:0.0} / {course.Silver,5:0.0} / {course.Bronze,5:0.0} s   " +
					(ok ? "fliegbar ✔" : $"FEHLER ✘ (Aufprall {impacts}, gelandet {landed}, tiefste Höhe {minAgl:0.0} m)") );
				if ( !ok ) fails++;
			}
		}

		// Bestzeit + Geist: erstes Rennen speichert die Bestzeit, das zweite fliegt gegen den Geist
		{
			var world = new TestWorld { Terrain = "flach", FlatH = 0.0 };
			var course = RaceCourses.Build( RaceCourses.All[0], world );
			RaceRecord saved = null;
			var first = Fly( course, world, null, false, out _, out _, out _, rec => saved = rec );
			Check( first != null && first.IsRecord && saved != null, "erstes Rennen = neue Bestzeit (wird gespeichert)" );
			Check( saved != null && saved.Splits.Count == course.Rings.Count, "Zwischenzeit für jeden Ring" );
			Check( saved != null && saved.Ghost.Count % GhostRecorder.Stride == 0 && saved.Ghost.Count / GhostRecorder.Stride > first.Time * 19,
				"Geist: ca. 20 Aufnahmen pro Sekunde" );
			var ghost = new GhostPlayer( saved.Ghost );
			bool alive = ghost.Sample( first.Time * 0.5, out DVec3 gp, out DQuat gq, out _, out _, out _ );
			Check( alive && Math.Abs( gq.X * gq.X + gq.Y * gq.Y + gq.Z * gq.Z + gq.W * gq.W - 1.0 ) < 1e-3 && gp.Y > 5.0,
				"Geist: Position und Drehung in der Mitte des Rennens" );
			Check( !ghost.Sample( first.Time + 2.0, out _, out _, out _, out _, out _ ), "Geist: nach dem Ziel zu Ende" );

			// zweites Rennen: etwas vorsichtiger (weniger Boost) → langsamer → keine neue Bestzeit, Abstand > 0
			double? lastDelta = null;
			var second = Fly( course, world, saved, true, out _, out _, out _, null, 0.2, d => lastDelta = d );
			Check( second != null && second.Best.HasValue && Math.Abs( second.Best.Value - first.Time ) < 1e-9, "zweites Rennen kennt die alte Bestzeit" );
			Check( lastDelta.HasValue, "Abstand zur Bestzeit bei jedem Ring" );
			Console.WriteLine( $"        (1. Rennen {RingRace.FormatTime( first.Time )} s, 2. Rennen mit weniger Boost {RingRace.FormatTime( second?.Time ?? 0 )} s, " +
				$"Abstand im Ziel {lastDelta:+0.00;-0.00} s, neue Bestzeit: {second?.IsRecord})" );
		}

		// Gegner: drei KI-Drachen fliegen mit (gleiche Physik), Platzierung
		Console.WriteLine( "\nGegner-Drachen (du = Autopilot)" );
		foreach ( var info in RaceCourses.All )
		{
			var world = new TestWorld { Terrain = "wellig" };
			var course = RaceCourses.Build( info, world );
			RingRace done = null;
			var res = Fly( course, world, null, false, out _, out _, out _, null, 0.6, null, 3, r => done = r );
			bool allIn = done != null && done.Rivals.TrueForAll( r => r.FinishTime != null );
			string rivals = done == null ? "" : string.Join( ", ", done.Rivals.ConvertAll( r =>
				$"{r.Name} {(r.FinishTime.HasValue ? RingRace.FormatTime( r.FinishTime.Value ) + " s" : "nicht im Ziel")}" ) );
			Console.WriteLine( $"  {info.Name,-12} du {RingRace.FormatTime( res?.Time ?? 0 )} s → Platz {res?.Place} von {res?.Racers} | {rivals}" );
			Check( res != null && res.Racers == 4 && res.Place >= 1 && res.Place <= 4, $"{info.Name}: Platz wird berechnet" );
			Check( allIn, $"{info.Name}: alle Gegner kommen ins Ziel" );
			if ( done != null )
			{
				var t = done.Rivals.ConvertAll( r => r.FinishTime ?? 1e9 );
				Check( t[0] > t[1] && t[1] > t[2], $"{info.Name}: leicht < mittel < schwer (schwer ist am schnellsten)" );
			}
		}

		Console.WriteLine( fails == 0 ? "Ringrennen: alles ok" : $"Ringrennen: {fails} Fehler!" );
		return fails == 0;
	}

	/** Ein ganzes Rennen mit dem Autopiloten fliegen (60 Bilder pro Sekunde, höchstens 5 Minuten) */
	static RaceResult Fly( RaceCourse course, TestWorld world, RaceRecord best, bool ghost,
		out int impacts, out bool landed, out double minAgl,
		Action<RaceRecord> onRecord = null, double boldness = 0.6, Action<double?> onDelta = null, int rivals = 0,
		Action<RingRace> after = null )
	{
		var flight = new DragonFlightModel();
		int imp = 0;
		bool land = false;
		flight.OnImpact = ( _, _ ) => imp++;
		flight.OnLand = ( _, _ ) => land = true;
		var race = new RingRace();
		race.OnNewRecord = onRecord;
		if ( onDelta != null ) race.OnRing = ( _, _, _, d ) => onDelta( d );
		race.Load( course, best, ghost, rivals );
		race.Begin( flight );
		var pilot = new DragonAutopilot { Boldness = boldness };
		var env = new DragonFlightEnv { World = world, Wind = DVec3.Zero, Assist = true, Turbulence = 0.0 };
		const double dt = 1.0 / 60.0;
		minAgl = 1e9;
		for ( int i = 0; i < 60 * 300 && race.State != RaceState.Finished; i++ )
		{
			DVec3 prev = flight.Position;
			var inp = race.State == RaceState.Running && race.NextRing != null
				? pilot.SteerRace( flight, course, race.Next )
				: new DragonFlightInput();
			flight.Update( dt, inp, env );
			race.Update( dt, flight, prev, env );
			if ( race.State == RaceState.Running ) minAgl = Math.Min( minAgl, flight.Agl );
		}
		// nach deinem Ziel: Gegner noch fertig fliegen lassen (höchstens 2 Minuten)
		for ( int i = 0; i < 60 * 120 && race.State == RaceState.Finished && race.Rivals.Exists( r => r.FinishTime == null ); i++ )
		{
			DVec3 prev = flight.Position;
			flight.Update( dt, new DragonFlightInput(), env );
			race.Update( dt, flight, prev, env );
		}
		after?.Invoke( race );
		impacts = imp;
		landed = land;
		return race.State == RaceState.Finished ? race.LastResult : null;
	}
}
