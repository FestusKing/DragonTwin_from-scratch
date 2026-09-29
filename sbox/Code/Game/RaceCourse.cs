// =====================================================================
//  RING-STRECKEN (Ringrennen) – ohne s&box, darum testbar (sbox/Tests/)
// =====================================================================
// Übertragen aus src/gameplay/Courses.js (Browser-Spiel). Unterschied: In s&box gibt es
// (noch) keine Insel mit Burg und Felsbogen. Die Ringe stehen darum an festen Stellen,
// ihre Höhe gilt ÜBER DEM BODEN – so passen sie auch, wenn später Gelände dazukommt.
//
// Alles im Physik-Raum: Meter, X = rechts, Y = oben, −Z = vorne (wie DragonFlightModel).
// Eine Strecke ändern: Zahlen in RaceCourses.All anpassen, dann sh sbox/Tests/run_all.sh
// (der Test fliegt jede Strecke mit einem Autopiloten ab und prüft, ob sie fliegbar ist).
// =====================================================================
using System;
using System.Collections.Generic;

namespace DragonFlight;

/** Ein Ring der Strecke */
public sealed class RaceRing
{
	public DVec3 Pos;      // Mitte (m)
	public DVec3 Normal;   // Flugrichtung durch den Ring (Länge 1)
	public double Radius;  // Innen-Radius (m)
}

/** Beschreibung einer Strecke (Name, Schwierigkeit, Ring-Stellen) */
public sealed class RaceCourseInfo
{
	public string Id;
	public string Name;
	public string Difficulty;
	public string Description;
	/** Ring-Stellen: X, Z (m), Höhe über dem Boden (m), Radius (m) */
	public (double X, double Z, double Above, double Radius)[] Spots;
}

/** Fertig gebaute Strecke */
public sealed class RaceCourse
{
	public RaceCourseInfo Info;
	public List<RaceRing> Rings = new();
	public double Length;          // m (für die Medaillen-Zeiten)
	public double Gold;            // s
	public double Silver;          // s
	public double Bronze;          // s
	public DVec3 StartPos;         // 85 m vor dem ersten Ring
	public double StartHeading;    // Blickrichtung (Radiant, 0 = −Z)
}

public static class RaceCourses
{
	/** Die Strecken. Der Drache startet jeweils 85 m vor dem ersten Ring. */
	public static readonly RaceCourseInfo[] All =
	{
		new()
		{
			Id = "runde",
			Name = "Übungsrunde",
			Difficulty = "Leicht",
			Description = "Eine weite Runde mit sanften Kurven – zum Üben.",
			Spots = new (double, double, double, double)[]
			{
				(0, -150, 40, 16), (80, -420, 45, 16), (260, -640, 50, 16), (500, -700, 45, 16),
				(700, -540, 40, 16), (740, -280, 35, 16), (600, -60, 35, 16), (380, 40, 40, 16),
				(160, 20, 45, 16), (-60, 60, 35, 16),
			},
		},
		new()
		{
			Id = "slalom",
			Name = "Slalom",
			Difficulty = "Mittel",
			Description = "Links, rechts, hoch, tief – und in einem Bogen zurück.",
			Spots = new (double, double, double, double)[]
			{
				(0, -150, 40, 14), (45, -350, 28, 13), (-45, -550, 55, 13), (45, -750, 28, 13),
				(-45, -950, 60, 13), (45, -1150, 30, 12), (0, -1350, 45, 12), (-200, -1520, 50, 13),
				(-430, -1430, 45, 13), (-500, -1170, 35, 13), (-420, -900, 25, 12), (-340, -640, 25, 12),
				(-280, -380, 40, 14),
			},
		},
		new()
		{
			Id = "sturzflug",
			Name = "Sturzflug",
			Difficulty = "Schwer",
			Description = "Hoch hinauf, dann steil hinunter durch enge Ringe knapp über dem Boden.",
			Spots = new (double, double, double, double)[]
			{
				(0, -150, 50, 14), (0, -420, 85, 14), (110, -690, 125, 13), (330, -860, 165, 13),
				(600, -820, 185, 13), (780, -600, 160, 12), (820, -320, 115, 12), (740, -70, 70, 12),
				(560, 100, 35, 11), (330, 170, 22, 11), (100, 110, 28, 12), (-80, -10, 40, 14),
			},
		},
	};

	public static RaceCourseInfo Find( string id )
	{
		foreach ( var c in All ) if ( c.Id == id ) return c;
		return All[0];
	}

	/** Strecke bauen: Höhe über dem Boden, Ausrichtung der Ringe, Länge, Medaillen, Start */
	public static RaceCourse Build( RaceCourseInfo info, IDragonFlightWorld world )
	{
		var course = new RaceCourse { Info = info };
		foreach ( var s in info.Spots )
		{
			double ground = Math.Max( world.GroundHeight( s.X, s.Z ), DragonFlightModel.WATER_LEVEL );
			course.Rings.Add( new RaceRing { Pos = new DVec3( s.X, ground + s.Above, s.Z ), Radius = s.Radius } );
		}
		// Ausrichtung: vom vorigen zum nächsten Ring (wie im Browser-Spiel), steile Stücke etwas flacher
		var r = course.Rings;
		for ( int i = 0; i < r.Count; i++ )
		{
			DVec3 prev = r[Math.Max( 0, i - 1 )].Pos;
			DVec3 next = r[Math.Min( r.Count - 1, i + 1 )].Pos;
			DVec3 n = next - prev;
			if ( i == 0 ) n = next - r[i].Pos;
			if ( i == r.Count - 1 ) n = r[i].Pos - prev;
			n.Y *= 0.6;
			r[i].Normal = n.SafeNormal();
		}
		// Streckenlänge (für die Medaillen-Zeiten, wie im Browser-Spiel)
		double length = 0.0;
		for ( int i = 1; i < r.Count; i++ ) length += (r[i].Pos - r[i - 1].Pos).Length;
		length += 70.0;
		course.Length = length;
		course.Gold = length / 52.0;
		course.Silver = length / 42.0;
		course.Bronze = length / 33.0;
		// Start: 85 m vor dem ersten Ring, mindestens 20 m über dem Boden
		DVec3 flat = r[0].Normal;
		flat.Y = 0.0;
		flat = flat.SafeNormal();
		DVec3 start = r[0].Pos - flat * 85.0;
		double g = Math.Max( world.GroundHeight( start.X, start.Z ), DragonFlightModel.WATER_LEVEL );
		start.Y = Math.Max( start.Y, g + 20.0 );
		course.StartPos = start;
		course.StartHeading = Math.Atan2( -flat.X, -flat.Z );
		return course;
	}
}
