// NUR FÜR DEN TEST (nicht nach s&box kopieren!)
// 1) Prüft die Umrechnung Physik-Raum ↔ s&box (DragonSpace.cs).
// 2) Führt die C#-Flugphysik (DragonFlightModel.cs) mit denselben Test-Flügen aus wie
//    unreal/Tests/run_js.mjs (Browser-Spiel) und flight_test.cpp (Unreal).
//    Liest out/<name>.env und out/<name>.in, schreibt out/<name>.cs.txt (gleiche Spalten).
// 3) Ringrennen: jede Strecke wird mit dem Autopiloten abgeflogen (ist sie fliegbar?),
//    dazu Ring-Treffer, Bestzeit und Geist (RaceTest.cs).
// Aufruf: FlightTest <out-Ordner> gleiten kurven …
using System;
using System.Globalization;
using System.IO;
using System.Text;
using DragonFlight;

static class Program
{
	static int Main( string[] args )
	{
		if ( args.Length < 2 )
		{
			Console.Error.WriteLine( "Aufruf: FlightTest <out-Ordner> <Flug> [<Flug> …]" );
			return 1;
		}
		if ( !SpaceTest.Run() ) return 1;
		string dir = args[0];
		for ( int a = 1; a < args.Length; a++ ) RunFlight( dir, args[a] );
		return RaceTest.Run() ? 0 : 1;
	}

	static string Fmt( double v ) => v.ToString( "R", CultureInfo.InvariantCulture );

	static void RunFlight( string dir, string name )
	{
		var world = new TestWorld();
		double seconds = 0, heading = 0, speed = 0;
		var startPos = DVec3.Zero;
		var wind = DVec3.Zero;
		bool assist = true;
		{
			string[] t = File.ReadAllText( Path.Combine( dir, name + ".env" ) )
				.Split( (char[])null, StringSplitOptions.RemoveEmptyEntries );
			int i = 0;
			double D() => double.Parse( t[i++], CultureInfo.InvariantCulture );
			while ( i < t.Length )
			{
				string key = t[i++];
				switch ( key )
				{
					case "seconds": seconds = D(); break;
					case "terrain": world.Terrain = t[i++]; break;
					case "flatH": world.FlatH = D(); break;
					case "start": startPos = new DVec3( D(), D(), D() ); heading = D(); speed = D(); break;
					case "assist": assist = D() != 0; break;
					case "wind": wind = new DVec3( D(), D(), D() ); break;
					case "box":
						world.BoxOn = D() != 0;
						world.Bx = D(); world.By = D(); world.Bz = D();
						world.Hx = D(); world.Hy = D(); world.Hz = D();
						world.Rot = D();
						break;
				}
			}
		}

		var m = new DragonFlightModel();
		int[] ev = new int[5]; // flap, impact, land, takeoff, splash
		m.OnFlap = _ => ev[0]++;
		m.OnImpact = ( _, _ ) => ev[1]++;
		m.OnLand = ( _, _ ) => ev[2]++;
		m.OnTakeoff = () => ev[3]++;
		m.OnSplash = _ => ev[4]++;
		m.Reset( startPos, heading, speed );

		var env = new DragonFlightEnv { World = world, Wind = wind, Assist = assist, Turbulence = 0.0 };

		var sb = new StringBuilder();
		int frame = 0;
		const double fps = 60.0;
		foreach ( string line in File.ReadAllLines( Path.Combine( dir, name + ".in" ) ) )
		{
			if ( line.Length == 0 ) continue;
			string[] c = line.Split( ' ', StringSplitOptions.RemoveEmptyEntries );
			double N( int k ) => double.Parse( c[k], CultureInfo.InvariantCulture );
			// Spalten: pitch roll flap flapPressed dive boost hover move land
			var inp = new DragonFlightInput
			{
				Pitch = N( 0 ),
				Roll = N( 1 ),
				Flap = N( 2 ) != 0,
				FlapPressed = N( 3 ) != 0,
				Dive = N( 4 ) != 0,
				Boost = N( 5 ) != 0,
				Hover = N( 6 ) != 0,
				Move = N( 7 ),
				Land = N( 8 ) != 0,
			};
			m.Update( 1.0 / fps, inp, env );
			double time = frame / fps + 1.0 / fps;
			DVec3 p = m.Position;
			DVec3 v = m.Velocity;
			DQuat q = m.Rotation;
			double[] vals =
			{
				time, p.X, p.Y, p.Z, v.X, v.Y, v.Z, q.X, q.Y, q.Z, q.W, m.Stamina, m.FlapPhase, m.FlapAmp, m.Fold,
				m.Grounded ? 1.0 : 0.0, m.Hovering ? 1.0 : 0.0, m.WalkSpeed, m.Bank, m.YawRate, m.Agl,
				ev[0], ev[1], ev[2], ev[3], ev[4],
			};
			for ( int k = 0; k < vals.Length; k++ )
			{
				if ( k > 0 ) sb.Append( ' ' );
				sb.Append( Fmt( vals[k] ) );
			}
			sb.Append( '\n' );
			frame++;
		}
		File.WriteAllText( Path.Combine( dir, name + ".cs.txt" ), sb.ToString() );
		Console.WriteLine( $"C#  {name,-15} {frame} Bilder ({seconds:0} s)" );
	}
}

/** Test-Welt: gleiche Gelände-Formeln wie scenarios.mjs und flight_test.cpp, Kiste wie src/world/Colliders.js */
sealed class TestWorld : IDragonFlightWorld
{
	public string Terrain = "wellig";
	public double FlatH;
	public bool BoxOn;
	public double Bx, By, Bz, Hx, Hy, Hz, Rot;

	public double GroundHeight( double x, double z )
	{
		if ( Terrain == "flach" ) return FlatH;
		if ( Terrain == "wasser" ) return -5.0;
		return 20.0 + 8.0 * Math.Sin( 0.01 * x ) * Math.Cos( 0.013 * z );
	}

	public DVec3 GroundNormal( double x, double z )
	{
		if ( Terrain != "wellig" ) return new DVec3( 0.0, 1.0, 0.0 );
		double dx = 8.0 * 0.01 * Math.Cos( 0.01 * x ) * Math.Cos( 0.013 * z );
		double dz = -8.0 * 0.013 * Math.Sin( 0.01 * x ) * Math.Sin( 0.013 * z );
		double l = Math.Sqrt( dx * dx + 1.0 + dz * dz );
		return new DVec3( -dx / l, 1.0 / l, -dz / l );
	}

	/** Kugel gegen gedrehte Kiste – wie Colliders.test (inkl. Raster mit 100-m-Zellen) */
	public double TestObstacles( DVec3 pos, double radius, out DVec3 normal )
	{
		normal = DVec3.Zero;
		if ( !BoxOn ) return 0.0;
		double r = Math.Sqrt( Hx * Hx + Hy * Hy + Hz * Hz );
		const double cell = 100.0;
		double ci = Math.Floor( pos.X / cell );
		double cj = Math.Floor( pos.Z / cell );
		if ( ci < Math.Floor( (Bx - r) / cell ) || ci > Math.Floor( (Bx + r) / cell ) ) return 0.0;
		if ( cj < Math.Floor( (Bz - r) / cell ) || cj > Math.Floor( (Bz + r) / cell ) ) return 0.0;

		double cos = Math.Cos( Rot );
		double sin = Math.Sin( Rot );
		double dx = pos.X - Bx;
		double dz = pos.Z - Bz;
		double lx = dx * cos - dz * sin;
		double lz = dx * sin + dz * cos;
		double ly = pos.Y - By;
		double px = Math.Max( -Hx, Math.Min( Hx, lx ) );
		double py = Math.Max( -Hy, Math.Min( Hy, ly ) );
		double pz = Math.Max( -Hz, Math.Min( Hz, lz ) );
		double ex = lx - px;
		double ey = ly - py;
		double ez = lz - pz;
		double d = Math.Sqrt( ex * ex + ey * ey + ez * ez );
		if ( d > radius ) return 0.0;
		if ( d < 1e-4 )
		{
			double ox = Hx - Math.Abs( lx );
			double oy = Hy - Math.Abs( ly );
			double oz = Hz - Math.Abs( lz );
			static double Sign( double v ) => v > 0 ? 1.0 : (v < 0 ? -1.0 : 0.0);
			if ( oy < ox && oy < oz )
			{
				ex = 0; ey = Sign( ly ) != 0 ? Sign( ly ) : 1; ez = 0; d = -oy;
			}
			else if ( ox < oz )
			{
				ex = Sign( lx ) != 0 ? Sign( lx ) : 1; ey = 0; ez = 0; d = -ox;
			}
			else
			{
				ex = 0; ey = 0; ez = Sign( lz ) != 0 ? Sign( lz ) : 1; d = -oz;
			}
		}
		else
		{
			ex /= d;
			ey /= d;
			ez /= d;
		}
		double depth = radius - d;
		if ( depth <= 0.0 ) return 0.0;
		normal = new DVec3( ex * cos + ez * sin, ey, -ex * sin + ez * cos );
		return depth;
	}
}

/** Prüft DragonSpace.cs – wie unreal/Tests/space_test.cpp, aber für s&box */
static class SpaceTest
{
	static int fails;

	static void Check( bool ok, string what )
	{
		Console.WriteLine( (ok ? "  ok   " : "FEHLER ") + what );
		if ( !ok ) fails++;
	}

	static bool Near( DVec3 a, DVec3 b, double eps = 1e-9 ) => (a - b).Length < eps;

	public static bool Run()
	{
		Console.WriteLine( "Umrechnung Physik-Raum <-> s&box" );
		Check( Near( DragonSpace.DirToSbox( new DVec3( 0, 0, -1 ) ), new DVec3( 1, 0, 0 ) ), "vorne (Physik -Z) = s&box +X" );
		Check( Near( DragonSpace.DirToSbox( new DVec3( 0, 1, 0 ) ), new DVec3( 0, 0, 1 ) ), "oben (Physik +Y) = s&box +Z" );
		Check( Near( DragonSpace.DirToSbox( new DVec3( 1, 0, 0 ) ), new DVec3( 0, -1, 0 ) ), "rechts (Physik +X) = s&box -Y (s&box: +Y = links)" );
		Check( Near( DragonSpace.ToSbox( new DVec3( 1, 2, 3 ) ), new DVec3( -3, -1, 2 ) * 39.37007874015748, 1e-9 ), "Meter -> Zoll (1 m = 39.37)" );

		var rng = new Random( 7 );
		double U() => rng.NextDouble() * 2.0 - 1.0;
		bool round = true, rot = true, qRound = true;
		for ( int i = 0; i < 1000; i++ )
		{
			var p = new DVec3( U() * 500, U() * 500, U() * 500 );
			if ( !Near( DragonSpace.ToPhysics( DragonSpace.ToSbox( p ) ), p, 1e-9 ) ) round = false;
			var axis = new DVec3( U(), U(), U() );
			axis = axis / axis.Length;
			DQuat q = DQuat.FromAxisAngle( axis, U() * 3.1 );
			var v = new DVec3( U(), U(), U() );
			// erst im Physik-Raum drehen und dann umrechnen = erst umrechnen und in s&box drehen
			DVec3 a = DragonSpace.DirToSbox( q.Rotate( v ) );
			DVec3 b = DragonSpace.QuatToSbox( q ).Rotate( DragonSpace.DirToSbox( v ) );
			if ( !Near( a, b, 1e-9 ) ) rot = false;
			DQuat q2 = DragonSpace.QuatToPhysics( DragonSpace.QuatToSbox( q ) );
			if ( Math.Abs( q2.X - q.X ) + Math.Abs( q2.Y - q.Y ) + Math.Abs( q2.Z - q.Z ) + Math.Abs( q2.W - q.W ) > 1e-12 ) qRound = false;
		}
		Check( round, "Punkte: hin und zurück (1000 Zufallspunkte)" );
		Check( rot, "Drehungen: gleiche Richtung in beiden Räumen (1000 Zufallsdrehungen)" );
		Check( qRound, "Drehungen: hin und zurück" );

		// Kurve nach links: Physik-Drehung um +Y (oben) um +30° → in s&box Drehung um +Z = Gieren nach links
		DQuat left = DQuat.FromAxisAngle( new DVec3( 0, 1, 0 ), 30.0 * Math.PI / 180.0 );
		DVec3 fwd = DragonSpace.QuatToSbox( left ).Rotate( new DVec3( 1, 0, 0 ) );
		Check( fwd.Y > 0.49 && fwd.Y < 0.51, "Kurve nach links = Nase zeigt in s&box nach +Y (links)" );
		// Blickrichtung aus dem Level: s&box +X = Heading 0, s&box +Y (links) = Heading +90°
		Check( Math.Abs( DragonSpace.HeadingFromSboxForward( new DVec3( 1, 0, 0 ) ) ) < 1e-12, "Start-Richtung s&box +X = Heading 0" );
		Check( Math.Abs( DragonSpace.HeadingFromSboxForward( new DVec3( 0, 1, 0 ) ) - Math.PI / 2 ) < 1e-12, "Start-Richtung s&box +Y = Heading +90° (links)" );
		Console.WriteLine( fails == 0 ? "Umrechnung: alles ok\n" : $"Umrechnung: {fails} Fehler!\n" );
		return fails == 0;
	}
}
