// =====================================================================
//  AUTOPILOT: ein Drache fliegt von selbst zu einem Ziel
// =====================================================================
// Gibt die gleichen Eingaben wie ein Spieler (W/S, A/D, Leertaste, Shift, E) an die Flugphysik.
// Er "schummelt" also nicht: Er fliegt mit derselben Physik wie der Spieler.
// Gebraucht für: den Test (ist jede Ring-Strecke fliegbar?) und später für Gegner-Drachen.
// Ohne s&box → testbar.
// =====================================================================
using System;

namespace DragonFlight;

public sealed class DragonAutopilot
{
	/** 0 … 1: wie oft Boost benutzt wird (Gegner-Stärke) */
	public double Boldness = 0.6;

	/** Wie stark er in die Kurve geht (grösser = enger, aber unruhiger) */
	public double TurnGain = 2.2;

	/** Wie stark er Höhe korrigiert */
	public double ClimbGain = 3.0;

	/** Höchsttempo (m/s) – kleiner = schwächerer Gegner */
	public double SpeedCap = 95.0;

	/** Grösste Schräglage, mit der er rechnet (etwas unter MAX_BANK der Flughilfe) */
	const double BankLimit = 1.1;

	/**
	 * Für Ringrennen: zum Ring Nummer index fliegen. Peilt einen Punkt VOR dem Ring an
	 * (gerade durchfliegen) und wird vor engen Kurven langsamer.
	 */
	public DragonFlightInput SteerRace( DragonFlightModel f, RaceCourse course, int index )
	{
		RaceRing ring = course.Rings[index];
		double dist = (ring.Pos - f.Position).Length;
		// Der Zielpunkt rutscht beim Näherkommen gleichmässig zur Ring-Mitte (kein Sprung)
		DVec3 aim = ring.Pos - ring.Normal * Math.Min( dist * 0.5, 80.0 );

		// Wie eng ist die Kurve nach diesem Ring? → Höchsttempo, damit die Kurve noch klappt
		double maxSpeed = 95.0;
		if ( index + 1 < course.Rings.Count )
		{
			DVec3 toNext = course.Rings[index + 1].Pos - ring.Pos;
			double d = toNext.Length;
			double turn = Math.Acos( Clamp( DVec3.Dot( ring.Normal, toNext / Math.Max( d, 1e-3 ) ), -1.0, 1.0 ) );
			if ( turn > 0.05 )
			{
				double radius = d / (2.0 * Math.Sin( Math.Min( turn, 2.8 ) * 0.5 )) * 0.8; // etwas Reserve
				maxSpeed = Math.Min( maxSpeed, Math.Sqrt( radius * DragonFlightModel.G * Math.Tan( BankLimit ) ) );
			}
		}
		// erst kurz vor dem Ring abbremsen
		if ( dist > 250.0 ) maxSpeed = 95.0;
		return Steer( f, aim, Math.Max( maxSpeed, 32.0 ) );
	}

	/** Eingaben für dieses Bild, um zum Ziel zu fliegen (maxSpeed in m/s: darüber bremsen) */
	public DragonFlightInput Steer( DragonFlightModel f, DVec3 target, double maxSpeed = 95.0 )
	{
		var inp = new DragonFlightInput();
		maxSpeed = Math.Min( maxSpeed, SpeedCap );
		DVec3 to = target - f.Position;
		double horiz = Math.Sqrt( to.X * to.X + to.Z * to.Z );
		DVec3 v = f.Velocity;
		double speed = v.Length;

		// Kurs: Winkel zwischen Flugrichtung und Richtung zum Ziel (> 0 = Ziel liegt links)
		DVec3 fwd = f.Forward;
		double have = speed > 3.0 ? Math.Atan2( -v.X, -v.Z ) : Math.Atan2( -fwd.X, -fwd.Z );
		double want = Math.Atan2( -to.X, -to.Z );
		double err = AngleDiff( have, want );
		double roll = Clamp( -err * TurnGain, -1.0, 1.0 ); // D = rechts = +1

		// Tempo passend zur nötigen Kurve: Um das Ziel (Abstand horiz, Winkel err) zu erreichen, braucht
		// es einen Kreis mit Radius horiz / (2 · sin err). Zu schnell dafür → bremsen, kein Boost.
		if ( Math.Abs( err ) > 0.05 && horiz > 1.0 )
		{
			double need = horiz / (2.0 * Math.Sin( Math.Min( Math.Abs( err ), Math.PI * 0.5 ) ));
			double vTurn = Math.Sqrt( need * DragonFlightModel.G * Math.Tan( BankLimit ) );
			maxSpeed = Math.Min( maxSpeed, Math.Max( vTurn, 30.0 ) );
		}

		// Liegt das Ziel weit seitlich INNERHALB des engsten Kurven-Kreises? Dann erreicht man es nie
		// (man kreist ewig darum herum) → erst geradeaus fliegen, bis es wieder erreichbar ist.
		double hs = Math.Sqrt( v.X * v.X + v.Z * v.Z );
		if ( hs > 5.0 && Math.Abs( err ) > 1.2 )
		{
			double turnRadius = hs * hs / (DragonFlightModel.G * Math.Tan( BankLimit ));
			double rx = -v.Z / hs; // rechts (waagrecht) zur Flugrichtung
			double rz = v.X / hs;
			double side = err > 0 ? -1.0 : 1.0; // Linkskurve: Mitte links
			double cx = f.Position.X + rx * turnRadius * side;
			double cz = f.Position.Z + rz * turnRadius * side;
			double dc = Math.Sqrt( (target.X - cx) * (target.X - cx) + (target.Z - cz) * (target.Z - cz) );
			if ( dc < turnRadius * 0.95 ) roll = 0.0;
		}
		inp.Roll = roll;

		// Höhe: Steigwinkel zum Ziel gegen den heutigen Steigwinkel
		double gWant = Math.Atan2( to.Y, Math.Max( horiz, 1.0 ) );
		double gHave = Math.Asin( Clamp( v.Y / Math.Max( speed, 1e-3 ), -1.0, 1.0 ) );
		double pitch = Clamp( (gWant - gHave) * ClimbGain, -1.0, 1.0 );
		// nie in den Boden
		if ( f.Agl < 14.0 && gHave < 0.05 ) pitch = Math.Max( pitch, 0.6 );
		inp.Pitch = pitch;
		inp.Move = pitch;

		inp.Flap = speed < 30.0 || gWant > 0.1;
		inp.Dive = gWant < -0.3 && speed < Math.Min( 85.0, maxSpeed ) && f.Agl > 25.0;
		inp.Boost = Boldness > 0.0 && f.Stamina > 1.0 - Boldness * 0.7 && Math.Abs( err ) < 0.4 && horiz > 120.0
			&& speed < maxSpeed - 5.0;
		// zu schnell für die nächste Kurve → bremsen (V). Erst ab 35 m/s, sonst schwebt er.
		inp.Hover = speed > maxSpeed + 6.0 && speed > 35.0;
		return inp;
	}

	static double Clamp( double v, double a, double b ) => v < a ? a : (v < b ? v : b);

	static double AngleDiff( double a, double b )
	{
		const double Tau = Math.PI * 2.0;
		double d = (b - a) % Tau;
		if ( d > Math.PI ) d -= Tau;
		if ( d < -Math.PI ) d += Tau;
		return d;
	}
}
