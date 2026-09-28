// Führt die C++-Flugphysik (DragonFlightModel.cpp) mit denselben Test-Flügen aus wie run_js.mjs.
// Liest out/<name>.env und out/<name>.in, schreibt out/<name>.cpp.txt (gleiche Spalten wie JS).
// Aufruf: flight_test out/ gleiten kurven …
#include "../Source/DragonTwinUE/Flight/DragonFlightModel.h"

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace
{
	struct FBox
	{
		bool bOn = false;
		double X = 0, Y = 0, Z = 0, Hx = 0, Hy = 0, Hz = 0, Rot = 0;
	};

	/** Test-Welt: gleiche Gelände-Formeln wie scenarios.mjs, Kiste wie src/world/Colliders.js */
	class FTestWorld : public IDragonFlightWorld
	{
	public:
		std::string Terrain = "wellig";
		double FlatH = 0.0;
		FBox Box;

		double GroundHeight(double X, double Z) const override
		{
			if (Terrain == "flach") return FlatH;
			if (Terrain == "wasser") return -5.0;
			return 20.0 + 8.0 * std::sin(0.01 * X) * std::cos(0.013 * Z);
		}

		FVector GroundNormal(double X, double Z) const override
		{
			if (Terrain != "wellig") return FVector(0.0, 1.0, 0.0);
			const double Dx = 8.0 * 0.01 * std::cos(0.01 * X) * std::cos(0.013 * Z);
			const double Dz = -8.0 * 0.013 * std::sin(0.01 * X) * std::sin(0.013 * Z);
			const double L = std::sqrt(Dx * Dx + 1.0 + Dz * Dz);
			return FVector(-Dx / L, 1.0 / L, -Dz / L);
		}

		/** Kugel gegen gedrehte Kiste – wie Colliders.test (inkl. Raster mit 100-m-Zellen) */
		double TestObstacles(const FVector& Pos, double Radius, FVector& OutNormal) const override
		{
			if (!Box.bOn) return 0.0;
			const FBox& C = Box;
			// Raster wie in Colliders.js: steht die Kiste in der Zelle des Drachen?
			const double R = std::sqrt(C.Hx * C.Hx + C.Hy * C.Hy + C.Hz * C.Hz);
			const double Cell = 100.0;
			const double Ci = std::floor(Pos.X / Cell);
			const double Cj = std::floor(Pos.Z / Cell);
			if (Ci < std::floor((C.X - R) / Cell) || Ci > std::floor((C.X + R) / Cell)) return 0.0;
			if (Cj < std::floor((C.Z - R) / Cell) || Cj > std::floor((C.Z + R) / Cell)) return 0.0;

			const double Cos = std::cos(C.Rot);
			const double Sin = std::sin(C.Rot);
			const double Dx = Pos.X - C.X;
			const double Dz = Pos.Z - C.Z;
			const double Lx = Dx * Cos - Dz * Sin;
			const double Lz = Dx * Sin + Dz * Cos;
			const double Ly = Pos.Y - C.Y;
			const double Px = std::max(-C.Hx, std::min(C.Hx, Lx));
			const double Py = std::max(-C.Hy, std::min(C.Hy, Ly));
			const double Pz = std::max(-C.Hz, std::min(C.Hz, Lz));
			double Ex = Lx - Px;
			double Ey = Ly - Py;
			double Ez = Lz - Pz;
			double D = std::sqrt(Ex * Ex + Ey * Ey + Ez * Ez);
			if (D > Radius) return 0.0;
			if (D < 1e-4)
			{
				const double Ox = C.Hx - std::fabs(Lx);
				const double Oy = C.Hy - std::fabs(Ly);
				const double Oz = C.Hz - std::fabs(Lz);
				auto Sign = [](double V) { return V > 0 ? 1.0 : (V < 0 ? -1.0 : 0.0); };
				if (Oy < Ox && Oy < Oz)
				{
					Ex = 0; Ey = Sign(Ly) != 0 ? Sign(Ly) : 1; Ez = 0; D = -Oy;
				}
				else if (Ox < Oz)
				{
					Ex = Sign(Lx) != 0 ? Sign(Lx) : 1; Ey = 0; Ez = 0; D = -Ox;
				}
				else
				{
					Ex = 0; Ey = 0; Ez = Sign(Lz) != 0 ? Sign(Lz) : 1; D = -Oz;
				}
			}
			else
			{
				Ex /= D;
				Ey /= D;
				Ez /= D;
			}
			const double Depth = Radius - D;
			if (Depth <= 0.0) return 0.0;
			OutNormal = FVector(Ex * Cos + Ez * Sin, Ey, -Ex * Sin + Ez * Cos);
			return Depth;
		}
	};

	std::string Fmt(double V)
	{
		char Buf[64];
		std::snprintf(Buf, sizeof(Buf), "%.17g", V);
		return Buf;
	}
}

int main(int Argc, char** Argv)
{
	if (Argc < 3)
	{
		std::fprintf(stderr, "Aufruf: flight_test <out-Ordner> <Flug> [<Flug> …]\n");
		return 1;
	}
	const std::string Dir = Argv[1];
	for (int A = 2; A < Argc; A++)
	{
		const std::string Name = Argv[A];
		FTestWorld World;
		double Seconds = 0, Heading = 0, Speed = 0;
		FVector StartPos, Wind;
		bool bAssist = true;
		{
			std::ifstream In(Dir + Name + ".env");
			std::string Key;
			while (In >> Key)
			{
				if (Key == "seconds") In >> Seconds;
				else if (Key == "terrain") In >> World.Terrain;
				else if (Key == "flatH") In >> World.FlatH;
				else if (Key == "start") In >> StartPos.X >> StartPos.Y >> StartPos.Z >> Heading >> Speed;
				else if (Key == "assist") { int V; In >> V; bAssist = V != 0; }
				else if (Key == "wind") In >> Wind.X >> Wind.Y >> Wind.Z;
				else if (Key == "box")
				{
					int V;
					In >> V >> World.Box.X >> World.Box.Y >> World.Box.Z >> World.Box.Hx >> World.Box.Hy >> World.Box.Hz >> World.Box.Rot;
					World.Box.bOn = V != 0;
				}
			}
		}
		FDragonFlightModel M;
		int Ev[5] = {0, 0, 0, 0, 0}; // flap, impact, land, takeoff, splash
		M.OnFlap = [&](double) { Ev[0]++; };
		M.OnImpact = [&](double, bool) { Ev[1]++; };
		M.OnLand = [&](bool, double) { Ev[2]++; };
		M.OnTakeoff = [&]() { Ev[3]++; };
		M.OnSplash = [&](double) { Ev[4]++; };
		M.Reset(StartPos, Heading, Speed);

		FDragonFlightEnv Env;
		Env.World = &World;
		Env.Wind = Wind;
		Env.bAssist = bAssist;
		Env.Turbulence = 0.0;

		std::ifstream In(Dir + Name + ".in");
		std::ofstream Out(Dir + Name + ".cpp.txt");
		std::string Line;
		int Frame = 0;
		const double Fps = 60.0;
		while (std::getline(In, Line))
		{
			if (Line.empty()) continue;
			std::istringstream S(Line);
			FDragonFlightInput I;
			int Flap, FlapPressed, Dive, Boost, Hover, Land;
			S >> I.Pitch >> I.Roll >> Flap >> FlapPressed >> Dive >> Boost >> Hover >> I.Move >> Land;
			I.bLand = Land != 0;
			I.bFlap = Flap != 0;
			I.bFlapPressed = FlapPressed != 0;
			I.bDive = Dive != 0;
			I.bBoost = Boost != 0;
			I.bHover = Hover != 0;
			M.Update(1.0 / Fps, I, Env);
			const double T = Frame / Fps + 1.0 / Fps;
			const FVector& P = M.Position;
			const FVector& V = M.Velocity;
			const FQuat& Q = M.Rotation;
			const double Vals[] = {T, P.X, P.Y, P.Z, V.X, V.Y, V.Z, Q.X, Q.Y, Q.Z, Q.W, M.Stamina, M.FlapPhase, M.FlapAmp, M.Fold,
				M.bGrounded ? 1.0 : 0.0, M.bHovering ? 1.0 : 0.0, M.WalkSpeed, M.Bank, M.YawRate, M.Agl,
				double(Ev[0]), double(Ev[1]), double(Ev[2]), double(Ev[3]), double(Ev[4])};
			std::string L;
			for (double X : Vals)
			{
				if (!L.empty()) L += ' ';
				L += Fmt(X);
			}
			Out << L << '\n';
			Frame++;
		}
		std::printf("C++ %-15s %d Bilder (%.0f s)\n", Name.c_str(), Frame, Seconds);
	}
	return 0;
}
