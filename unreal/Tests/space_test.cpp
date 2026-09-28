// Prüft die Umrechnung Physik-Raum ↔ Unreal (DragonSpace.h):
//  1) Achsen: vorne/oben/rechts landen auf Unreal +X/+Z/+Y
//  2) Hin und zurück ergibt wieder dasselbe
//  3) Drehungen passen: erst drehen, dann umrechnen = erst umrechnen, dann drehen
//  4) Kurve nach links im Browser-Spiel = negatives Gieren (Yaw) in Unreal
#include "../Source/DragonTwinUE/Flight/DragonSpace.h"

#include <cstdio>
#include <random>

namespace
{
	int Fails = 0;

	void Check(bool bOk, const char* What)
	{
		std::printf("%s %s\n", bOk ? "  ok  " : "FEHLER", What);
		if (!bOk) Fails++;
	}

	bool Near(const FVector& A, const FVector& B, double Eps = 1e-9)
	{
		return (A - B).Size() < Eps;
	}
}

int main()
{
	using namespace DragonSpace;
	std::printf("Umrechnung Physik-Raum <-> Unreal\n");
	Check(Near(DirToUnreal(FVector(0, 0, -1)), FVector(1, 0, 0)), "vorne (Physik -Z) = Unreal +X");
	Check(Near(DirToUnreal(FVector(0, 1, 0)), FVector(0, 0, 1)), "oben (Physik +Y) = Unreal +Z");
	Check(Near(DirToUnreal(FVector(1, 0, 0)), FVector(0, 1, 0)), "rechts (Physik +X) = Unreal +Y");
	Check(Near(ToUnreal(FVector(1, 2, 3)), FVector(-300, 100, 200)), "Meter -> Zentimeter");

	std::mt19937 Rng(7);
	std::uniform_real_distribution<double> U(-1.0, 1.0);
	bool bRound = true;
	bool bRot = true;
	bool bQRound = true;
	for (int I = 0; I < 1000; I++)
	{
		const FVector P(U(Rng) * 500, U(Rng) * 500, U(Rng) * 500);
		if (!Near(ToPhysics(ToUnreal(P)), P, 1e-9)) bRound = false;
		FVector Axis(U(Rng), U(Rng), U(Rng));
		Axis = Axis / Axis.Size();
		const FQuat Q(Axis, U(Rng) * 3.1);
		const FVector V(U(Rng), U(Rng), U(Rng));
		// erst im Physik-Raum drehen und dann umrechnen = erst umrechnen und in Unreal drehen
		const FVector A = DirToUnreal(Q.RotateVector(V));
		const FVector B = QuatToUnreal(Q).RotateVector(DirToUnreal(V));
		if (!Near(A, B, 1e-9)) bRot = false;
		const FQuat Q2 = QuatToPhysics(QuatToUnreal(Q));
		if (std::fabs(Q2.X - Q.X) + std::fabs(Q2.Y - Q.Y) + std::fabs(Q2.Z - Q.Z) + std::fabs(Q2.W - Q.W) > 1e-12) bQRound = false;
	}
	Check(bRound, "Punkte: hin und zurück (1000 Zufallspunkte)");
	Check(bRot, "Drehungen: gleiche Richtung in beiden Räumen (1000 Zufallsdrehungen)");
	Check(bQRound, "Drehungen: hin und zurück");

	// Kurve nach links: Physik-Drehung um +Y (oben) um +30°
	const FQuat Left(FVector(0, 1, 0), 30.0 * 3.14159265358979 / 180.0);
	const FVector Fwd = QuatToUnreal(Left).RotateVector(FVector(1, 0, 0)); // Unreal vorne nach der Drehung
	Check(Fwd.Y < -0.49 && Fwd.Y > -0.51, "Linkskurve im Browser-Spiel = nach links (−Y) in Unreal");

	std::printf(Fails ? "\n%d Fehler!\n" : "\nUmrechnung stimmt.\n", Fails);
	return Fails ? 1 : 0;
}
