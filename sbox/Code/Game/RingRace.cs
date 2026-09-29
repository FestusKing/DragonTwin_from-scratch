// =====================================================================
//  RINGRENNEN (Zeitfahren) – Spiel-Logik ohne s&box, darum testbar
// =====================================================================
// Übertragen aus src/gameplay/RingRace.js: Countdown, Ringe in der richtigen Reihenfolge,
// Zwischenzeiten, Medaillen, Bestzeit und Geist. Das Anzeigen (Ringe, Farben, Text)
// macht die s&box-Komponente RaceComponent.cs.
// =====================================================================
using System;
using System.Collections.Generic;

namespace DragonFlight;

public enum RaceState { Idle, Countdown, Running, Finished }

public enum RaceMedal { None, Bronze, Silver, Gold }

/** Bestzeit einer Strecke (wird gespeichert). Eigenschaften mit get/set → als JSON speicherbar. */
public sealed class RaceRecord
{
	public double Time { get; set; }
	public List<double> Splits { get; set; } = new();
	public List<float> Ghost { get; set; } = new();
}

/** Ergebnis eines Rennens */
public sealed class RaceResult
{
	public string CourseId;
	public double Time;
	public double? Best;       // alte Bestzeit (null = noch keine)
	public bool IsRecord;
	public RaceMedal Medal;
	public int Place = 1;      // Platz gegen die Gegner (1 = Sieg)
	public int Racers = 1;     // Anzahl Drachen im Rennen (mit dir)
}

/** Ein Gegner-Drache im Rennen: eigene Flugphysik + Autopilot (gleiche Physik wie der Spieler) */
public sealed class RaceRival
{
	public string Name;
	public DragonFlightModel Flight = new();
	public DragonAutopilot Pilot = new();
	public int Next;
	public double? FinishTime;
	public double Right;       // Start: so weit rechts neben dir (m, negativ = links)
	public double Back;        // Start: so weit hinter dir (m)

	/** Die drei Gegner: leicht, mittel, schwer */
	public static List<RaceRival> CreateDefault( int count )
	{
		var all = new List<RaceRival>
		{
			new() { Name = "Glutschwinge", Right = 45.0, Pilot = new DragonAutopilot { Boldness = 0.15, SpeedCap = 44.0 } },
			new() { Name = "Sturmkralle", Right = -45.0, Pilot = new DragonAutopilot { Boldness = 0.4, SpeedCap = 55.0 } },
			new() { Name = "Nebelzahn", Back = 50.0, Pilot = new DragonAutopilot { Boldness = 0.7, SpeedCap = 95.0 } },
		};
		return all.GetRange( 0, Math.Clamp( count, 0, all.Count ) );
	}
}

public sealed class RingRace
{
	public const double CountdownSeconds = 3.2;
	public const double StartSpeed = 34.0;

	public RaceCourse Course { get; private set; }
	public RaceState State { get; private set; } = RaceState.Idle;
	public double Time { get; private set; }         // deine Zeit (bleibt im Ziel stehen)
	public double Clock { get; private set; }        // Renn-Uhr (läuft weiter, bis alle im Ziel sind)
	public double CountdownLeft { get; private set; }
	public int Next { get; private set; }
	public List<double> Splits { get; private set; } = new();
	public RaceRecord Record { get; private set; }
	public GhostPlayer Ghost { get; private set; }
	public RaceResult LastResult { get; private set; }

	/** Gegner-Drachen (leer = Zeitfahren allein) */
	public List<RaceRival> Rivals { get; private set; } = new();

	readonly GhostRecorder recorder = new();
	int lastCount;

	// Ereignisse (für Anzeige, Töne, Speichern)
	public Action<int> OnCountdown;                  // 3, 2, 1
	public Action OnGo;                              // los!
	public Action<int, int, double, double?> OnRing; // Ring-Nummer, Anzahl, Zeit, Abstand zur Bestzeit (+ = langsamer)
	public Action<RaceResult> OnFinish;
	public Action<RaceRecord> OnNewRecord;           // → speichern
	public Action<RaceRival, int> OnRivalFinish;     // Gegner im Ziel, sein Platz

	public RaceRing NextRing => Course != null && Next < Course.Rings.Count ? Course.Rings[Next] : null;

	/** Strecke laden. best = gespeicherte Bestzeit (oder null), useGhost = gegen den Geist fliegen,
	 *  rivals = Anzahl Gegner-Drachen (0 bis 3) */
	public void Load( RaceCourse course, RaceRecord best, bool useGhost, int rivals = 0 )
	{
		Rivals = RaceRival.CreateDefault( rivals );
		Course = course;
		Record = best;
		Ghost = useGhost && best != null && best.Ghost != null && best.Ghost.Count >= 2 * GhostRecorder.Stride
			? new GhostPlayer( best.Ghost )
			: null;
		State = RaceState.Idle;
		Next = 0;
		Splits = new List<double>();
	}

	/** Drache an den Start setzen, festhalten, Countdown läuft */
	public void Begin( DragonFlightModel flight )
	{
		if ( Course == null ) return;
		flight.Reset( Course.StartPos, Course.StartHeading, 0.0 );
		flight.Frozen = true;
		State = RaceState.Countdown;
		CountdownLeft = CountdownSeconds;
		lastCount = 4;
		Time = 0.0;
		Clock = 0.0;
		Next = 0;
		Splits = new List<double>();
		LastResult = null;
		recorder.Reset();
		finishedCount = 0;
		// Gegner neben / hinter den Spieler stellen
		double h = Course.StartHeading;
		var fwd = new DVec3( -Math.Sin( h ), 0.0, -Math.Cos( h ) );
		var right = new DVec3( Math.Cos( h ), 0.0, -Math.Sin( h ) );
		foreach ( var r in Rivals )
		{
			DVec3 p = Course.StartPos + right * r.Right - fwd * r.Back + new DVec3( 0.0, r.Back > 0.0 ? 10.0 : 0.0, 0.0 );
			r.Flight.Reset( p, h, 0.0 );
			r.Flight.Frozen = true;
			r.Next = 0;
			r.FinishTime = null;
		}
	}

	int finishedCount; // wie viele Drachen (mit dir) schon im Ziel sind

	/** Rennen abbrechen (Drache fliegt frei weiter) */
	public void Cancel( DragonFlightModel flight )
	{
		if ( flight != null ) flight.Frozen = false;
		State = RaceState.Idle;
	}

	/**
	 * Einmal pro Bild NACH der Flugphysik des Spielers aufrufen. prevPos = Position vor diesem Bild.
	 * env = Welt für die Gegner-Drachen (die rechnet das Rennen selbst).
	 */
	public void Update( double dt, DragonFlightModel flight, DVec3 prevPos, DragonFlightEnv env )
	{
		if ( State == RaceState.Running || State == RaceState.Finished ) Clock += dt;
		UpdateRivals( dt, env );
		if ( State == RaceState.Countdown )
		{
			CountdownLeft -= dt;
			int c = (int)Math.Ceiling( CountdownLeft );
			if ( c < lastCount && c >= 1 && c <= 3 )
			{
				lastCount = c;
				OnCountdown?.Invoke( c );
			}
			if ( CountdownLeft <= 0.0 )
			{
				State = RaceState.Running;
				flight.Frozen = false;
				flight.Reset( Course.StartPos, Course.StartHeading, StartSpeed );
				flight.FlapAmp = 1.0;
				foreach ( var rival in Rivals )
				{
					DVec3 p = rival.Flight.Position;
					rival.Flight.Frozen = false;
					rival.Flight.Reset( p, Course.StartHeading, StartSpeed );
					rival.Flight.FlapAmp = 1.0;
				}
				OnGo?.Invoke();
			}
			return;
		}
		if ( State != RaceState.Running ) return;

		Time += dt;
		recorder.Record( dt, flight );
		RaceRing r = NextRing;
		if ( r != null && Crossed( prevPos, flight.Position, r ) )
		{
			int i = Next;
			Splits.Add( Time );
			double? delta = null;
			if ( Record != null && Record.Splits != null && i < Record.Splits.Count ) delta = Time - Record.Splits[i];
			Next++;
			OnRing?.Invoke( i, Course.Rings.Count, Time, delta );
			if ( Next >= Course.Rings.Count ) Finish();
		}
	}

	/** Gegner fliegen lassen (auch nach deinem Ziel, bis sie selbst im Ziel sind) */
	void UpdateRivals( double dt, DragonFlightEnv env )
	{
		if ( State == RaceState.Idle || env.World == null ) return;
		foreach ( var r in Rivals )
		{
			DragonFlightInput inp = default;
			bool racing = State != RaceState.Countdown && r.FinishTime == null;
			if ( racing ) inp = r.Pilot.SteerRace( r.Flight, Course, r.Next );
			else if ( r.FinishTime != null ) inp = new DragonFlightInput { Roll = 0.4 }; // nach dem Ziel: Kreise ziehen
			DVec3 prev = r.Flight.Position;
			r.Flight.Update( dt, inp, env );
			if ( !racing ) continue;
			if ( Crossed( prev, r.Flight.Position, Course.Rings[r.Next] ) )
			{
				r.Next++;
				if ( r.Next >= Course.Rings.Count )
				{
					r.FinishTime = Clock;
					finishedCount++;
					OnRivalFinish?.Invoke( r, finishedCount );
				}
			}
		}
	}

	/** Dein Platz im Moment (1 = vorne): wer mehr Ringe hat oder gleich viele und näher am nächsten ist */
	public int CurrentPlace( DragonFlightModel flight )
	{
		if ( State == RaceState.Finished && LastResult != null ) return LastResult.Place;
		double mine = Progress( Next, flight.Position );
		int place = 1;
		foreach ( var r in Rivals )
		{
			if ( r.FinishTime != null || Progress( r.Next, r.Flight.Position ) > mine ) place++;
		}
		return place;
	}

	double Progress( int next, DVec3 pos )
	{
		if ( next >= Course.Rings.Count ) return 1e9;
		return next * 100000.0 - (Course.Rings[next].Pos - pos).Length;
	}

	/** Hat die Strecke von a nach b die Ringfläche durchstossen? (wie im Browser-Spiel) */
	public static bool Crossed( DVec3 a, DVec3 b, RaceRing r )
	{
		double d0 = DVec3.Dot( a - r.Pos, r.Normal );
		double d1 = DVec3.Dot( b - r.Pos, r.Normal );
		if ( (d0 < 0 && d1 >= 0) || (d0 > 0 && d1 <= 0) )
		{
			double t = d0 / (d0 - d1);
			DVec3 hit = a + (b - a) * t;
			return (hit - r.Pos).Length < r.Radius * 1.08 + 1.5;
		}
		// sehr nahe an der Mitte zählt auch (falls ein Bild übersprungen wurde)
		return (b - r.Pos).Length < r.Radius * 0.35;
	}

	void Finish()
	{
		State = RaceState.Finished;
		double? best = Record?.Time;
		bool isRecord = best == null || Time < best.Value;
		var medal = Time <= Course.Gold ? RaceMedal.Gold
			: Time <= Course.Silver ? RaceMedal.Silver
			: Time <= Course.Bronze ? RaceMedal.Bronze
			: RaceMedal.None;
		if ( isRecord )
		{
			Record = new RaceRecord { Time = Time, Splits = new List<double>( Splits ), Ghost = new List<float>( recorder.Data ) };
			OnNewRecord?.Invoke( Record );
		}
		finishedCount++;
		LastResult = new RaceResult
		{
			CourseId = Course.Info.Id, Time = Time, Best = best, IsRecord = isRecord, Medal = medal,
			Place = finishedCount, Racers = Rivals.Count + 1,
		};
		OnFinish?.Invoke( LastResult );
	}

	/** Zeit als Text, z. B. 1:05.32 */
	public static string FormatTime( double t )
	{
		if ( t < 0 ) t = 0;
		int min = (int)(t / 60.0);
		double sec = t - min * 60;
		return min > 0 ? $"{min}:{sec:00.00}" : $"{sec:0.00}";
	}

	public static string MedalName( RaceMedal m ) => m switch
	{
		RaceMedal.Gold => "Gold",
		RaceMedal.Silver => "Silber",
		RaceMedal.Bronze => "Bronze",
		_ => "keine Medaille",
	};
}
