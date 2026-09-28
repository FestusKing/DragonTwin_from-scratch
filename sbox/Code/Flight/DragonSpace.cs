// Umrechnung zwischen s&box und dem Physik-Raum der Flugphysik (DragonFlightModel).
//
//   Physik-Raum (wie das Browser-Spiel): Meter,       X = rechts, Y = oben,  −Z = vorne
//   s&box:                               Zoll (inch), X = vorne,  Y = links, Z = oben
//
//   sbox.X = −Physik.Z · 39.37
//   sbox.Y = −Physik.X · 39.37
//   sbox.Z =  Physik.Y · 39.37
//
// Beide Räume sind "rechtshändig" → der Drehsinn bleibt gleich (anders als bei Unreal).
// Ein Quaternion wird darum nur umsortiert: (x, y, z, w) → (−z, −x, y, w).
// 1 Zoll = 2.54 cm → 1 m = 39.37 Einheiten. Ein Test prüft das: sbox/Tests/ (Umrechnung).
// Diese Datei braucht NICHTS von s&box (nur double) → ohne s&box testbar.
using System;

namespace DragonFlight;

public static class DragonSpace
{
	/** s&box-Einheiten pro Meter (1 Einheit = 1 Zoll = 0.0254 m) */
	public const double UnitsPerMeter = 1.0 / 0.0254;

	/** Richtung (ohne Längen-Umrechnung): Physik → s&box */
	public static DVec3 DirToSbox( DVec3 p ) => new( -p.Z, -p.X, p.Y );

	/** Richtung (ohne Längen-Umrechnung): s&box → Physik */
	public static DVec3 DirToPhysics( DVec3 s ) => new( -s.Y, s.Z, -s.X );

	/** Punkt: Physik (m) → s&box (Zoll) */
	public static DVec3 ToSbox( DVec3 p ) => DirToSbox( p ) * UnitsPerMeter;

	/** Punkt: s&box (Zoll) → Physik (m) */
	public static DVec3 ToPhysics( DVec3 s ) => DirToPhysics( s ) / UnitsPerMeter;

	/** Drehung: Physik → s&box */
	public static DQuat QuatToSbox( DQuat q ) => new( -q.Z, -q.X, q.Y, q.W );

	/** Drehung: s&box → Physik */
	public static DQuat QuatToPhysics( DQuat q ) => new( -q.Y, q.Z, -q.X, q.W );

	/** Blickrichtung (Radiant, 0 = Physik −Z) aus einer s&box-Richtung "vorne" */
	public static double HeadingFromSboxForward( DVec3 sboxForward )
	{
		DVec3 a = DirToPhysics( sboxForward );
		return Math.Atan2( -a.X, -a.Z );
	}
}
