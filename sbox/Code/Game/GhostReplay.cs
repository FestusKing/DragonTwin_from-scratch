// Geist-Wiederholung: 20× pro Sekunde Position, Drehung und Flügelschlag speichern.
// Beim nächsten Rennen fliegt ein zweiter Drache genau diese Bahn nach – so tritt man
// gegen die eigene Bestzeit an. Übertragen aus src/gameplay/GhostReplay.js.
// Ohne s&box (nur Zahlen) → testbar.
using System;
using System.Collections.Generic;

namespace DragonFlight;

public sealed class GhostRecorder
{
	public const int Rate = 20;   // Aufnahmen pro Sekunde
	public const int Stride = 10; // Zahlen pro Aufnahme: x y z qx qy qz qw phase amp fold

	public List<float> Data = new();
	double acc;

	public void Reset()
	{
		Data = new List<float>();
		acc = 0.0;
	}

	public void Record( double dt, DragonFlightModel f )
	{
		acc += dt;
		if ( acc < 1.0 / Rate && Data.Count > 0 ) return;
		acc = 0.0;
		DVec3 p = f.Position;
		DQuat q = f.Rotation;
		Data.Add( (float)p.X );
		Data.Add( (float)p.Y );
		Data.Add( (float)p.Z );
		Data.Add( (float)q.X );
		Data.Add( (float)q.Y );
		Data.Add( (float)q.Z );
		Data.Add( (float)q.W );
		Data.Add( (float)f.FlapPhase );
		Data.Add( (float)f.FlapAmp );
		Data.Add( (float)f.Fold );
	}
}

public sealed class GhostPlayer
{
	readonly List<float> d;
	readonly int frames;
	public readonly double Duration;

	public GhostPlayer( List<float> data )
	{
		d = data;
		frames = data.Count / GhostRecorder.Stride;
		Duration = Math.Max( 0, frames - 1 ) / (double)GhostRecorder.Rate;
	}

	public bool Valid => frames >= 2;

	/** Zustand zur Zeit t (Sekunden seit Start), zwischen zwei Aufnahmen gemischt. false = Bahn zu Ende. */
	public bool Sample( double t, out DVec3 pos, out DQuat rot, out double flapPhase, out double flapAmp, out double fold )
	{
		const int S = GhostRecorder.Stride;
		double f = Math.Max( 0.0, Math.Min( frames - 1.001, t * GhostRecorder.Rate ) );
		int i = (int)Math.Floor( f );
		double k = f - i;
		int a = i * S;
		int b = (i + 1) * S;
		double L( int o ) => d[a + o] + (d[b + o] - d[a + o]) * k;
		pos = new DVec3( L( 0 ), L( 1 ), L( 2 ) );
		var qa = new DQuat( d[a + 3], d[a + 4], d[a + 5], d[a + 6] );
		var qb = new DQuat( d[b + 3], d[b + 4], d[b + 5], d[b + 6] );
		rot = DQuat.Slerp( qa, qb, k );
		// Flügelphase kann von 0.99 auf 0.01 springen → sauber mischen
		double pa = d[a + 7];
		double pb = d[b + 7];
		if ( pb < pa - 0.5 ) pb += 1.0;
		flapPhase = (pa + (pb - pa) * k) % 1.0;
		flapAmp = L( 8 );
		fold = L( 9 );
		return t <= Duration;
	}
}
