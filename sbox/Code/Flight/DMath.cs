// =====================================================================
//  Kleine Mathe für die Flugphysik (double = genau wie das Browser-Spiel)
// =====================================================================
// s&box hat eigene Typen (Vector3, Rotation), aber die rechnen mit float.
// Die Flugphysik rechnet mit double – so fliegt der Drache genau wie im Browser-Spiel
// und wie in der C++-Version für Unreal. Umgerechnet wird nur an der Grenze (DragonSpace.cs).
//
// Die Rechenwege folgen der Unreal-Mathe (unreal/Tests/ue_stub/CoreMinimal.h):
// Quaternion-Multiplikation (Hamilton), RotateVector, Slerp, Normalize.
// Diese Datei braucht NICHTS von s&box → sie lässt sich auch ohne s&box testen (sbox/Tests/).
// =====================================================================
using System;

namespace DragonFlight;

/** Vektor mit double (Physik-Raum: Meter, X = rechts, Y = oben, −Z = vorne) */
public struct DVec3
{
	public double X;
	public double Y;
	public double Z;

	public DVec3( double x, double y, double z )
	{
		X = x;
		Y = y;
		Z = z;
	}

	public static readonly DVec3 Zero = new( 0.0, 0.0, 0.0 );

	public static DVec3 operator +( DVec3 a, DVec3 b ) => new( a.X + b.X, a.Y + b.Y, a.Z + b.Z );
	public static DVec3 operator -( DVec3 a, DVec3 b ) => new( a.X - b.X, a.Y - b.Y, a.Z - b.Z );
	public static DVec3 operator -( DVec3 a ) => new( -a.X, -a.Y, -a.Z );
	public static DVec3 operator *( DVec3 a, double s ) => new( a.X * s, a.Y * s, a.Z * s );
	public static DVec3 operator *( double s, DVec3 a ) => new( a.X * s, a.Y * s, a.Z * s );

	/** Wie Unreal: erst 1/s rechnen, dann malnehmen (gleiche Rundung wie die C++-Version) */
	public static DVec3 operator /( DVec3 a, double s )
	{
		double r = 1.0 / s;
		return new DVec3( a.X * r, a.Y * r, a.Z * r );
	}

	/** Skalarprodukt */
	public static double Dot( DVec3 a, DVec3 b ) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;

	/** Kreuzprodukt */
	public static DVec3 Cross( DVec3 a, DVec3 b ) =>
		new( a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X );

	public double Length => Math.Sqrt( X * X + Y * Y + Z * Z );
	public double LengthSquared => X * X + Y * Y + Z * Z;

	/** Länge 1 (wie Unreal GetSafeNormal: sehr kurz → Nullvektor) */
	public DVec3 SafeNormal( double tolerance = 1e-8 )
	{
		double s = LengthSquared;
		if ( s == 1.0 ) return this;
		if ( s < tolerance ) return Zero;
		double scale = 1.0 / Math.Sqrt( s );
		return new DVec3( X * scale, Y * scale, Z * scale );
	}

	public override string ToString() => $"({X:0.###}, {Y:0.###}, {Z:0.###})";
}

/** Drehung (Quaternion) mit double */
public struct DQuat
{
	public double X;
	public double Y;
	public double Z;
	public double W;

	public DQuat( double x, double y, double z, double w )
	{
		X = x;
		Y = y;
		Z = z;
		W = w;
	}

	public static readonly DQuat Identity = new( 0.0, 0.0, 0.0, 1.0 );

	/** Drehung um eine Achse (Länge 1) um angleRad */
	public static DQuat FromAxisAngle( DVec3 axis, double angleRad )
	{
		double h = 0.5 * angleRad;
		double s = Math.Sin( h );
		return new DQuat( s * axis.X, s * axis.Y, s * axis.Z, Math.Cos( h ) );
	}

	/** a * b = zuerst b, dann a (Hamilton-Produkt, wie Unreal und three.js) */
	public static DQuat operator *( DQuat a, DQuat b ) => new(
		a.W * b.X + a.X * b.W + a.Y * b.Z - a.Z * b.Y,
		a.W * b.Y - a.X * b.Z + a.Y * b.W + a.Z * b.X,
		a.W * b.Z + a.X * b.Y - a.Y * b.X + a.Z * b.W,
		a.W * b.W - a.X * b.X - a.Y * b.Y - a.Z * b.Z );

	/** Vektor drehen (gleicher Rechenweg wie Unreal FQuat::RotateVector) */
	public DVec3 Rotate( DVec3 v )
	{
		var q = new DVec3( X, Y, Z );
		DVec3 t = DVec3.Cross( q, v ) * 2.0;
		return v + t * W + DVec3.Cross( q, t );
	}

	public DQuat Normalized()
	{
		double s = X * X + Y * Y + Z * Z + W * W;
		if ( s < 1e-8 ) return Identity;
		double scale = 1.0 / Math.Sqrt( s );
		return new DQuat( X * scale, Y * scale, Z * scale, W * scale );
	}

	/** Wie Unreal: kürzester Weg, bei sehr kleinem Winkel lineare Mischung, dann normalisieren */
	public static DQuat Slerp( DQuat a, DQuat b, double alpha )
	{
		double rawCosom = a.X * b.X + a.Y * b.Y + a.Z * b.Z + a.W * b.W;
		double cosom = rawCosom >= 0.0 ? rawCosom : -rawCosom;
		double scale0;
		double scale1;
		if ( cosom < 0.9999 )
		{
			double omega = Math.Acos( cosom );
			double invSin = 1.0 / Math.Sin( omega );
			scale0 = Math.Sin( (1.0 - alpha) * omega ) * invSin;
			scale1 = Math.Sin( alpha * omega ) * invSin;
		}
		else
		{
			scale0 = 1.0 - alpha;
			scale1 = alpha;
		}
		scale1 = rawCosom >= 0.0 ? scale1 : -scale1;
		var r = new DQuat(
			scale0 * a.X + scale1 * b.X,
			scale0 * a.Y + scale1 * b.Y,
			scale0 * a.Z + scale1 * b.Z,
			scale0 * a.W + scale1 * b.W );
		return r.Normalized();
	}

	public override string ToString() => $"({X:0.####}, {Y:0.####}, {Z:0.####}, {W:0.####})";
}
