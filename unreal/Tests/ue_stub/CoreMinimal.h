// NUR FÜR DEN TEST (nicht nach Unreal kopieren!)
// Eine kleine Nachbildung der Unreal-Mathe (FVector, FQuat, FMath, TFunction), damit
// die Flugphysik (DragonFlightModel.cpp) auch ohne Unreal kompiliert und getestet werden kann.
// Die Rechenwege folgen Unreal: FQuat-Multiplikation (Hamilton), RotateVector,
// Slerp (mit linearer Mischung bei sehr kleinen Winkeln) und GetSafeNormal.
#pragma once

#include <cmath>
#include <cstdint>
#include <functional>
#include <random>

using int32 = std::int32_t;

template <typename Sig>
using TFunction = std::function<Sig>;

struct FVector
{
	double X = 0.0, Y = 0.0, Z = 0.0;
	FVector() = default;
	FVector(double InX, double InY, double InZ) : X(InX), Y(InY), Z(InZ) {}

	FVector operator+(const FVector& V) const { return FVector(X + V.X, Y + V.Y, Z + V.Z); }
	FVector operator-(const FVector& V) const { return FVector(X - V.X, Y - V.Y, Z - V.Z); }
	FVector operator-() const { return FVector(-X, -Y, -Z); }
	FVector operator*(double S) const { return FVector(X * S, Y * S, Z * S); }
	FVector operator/(double S) const { const double R = 1.0 / S; return FVector(X * R, Y * R, Z * R); }
	FVector& operator+=(const FVector& V) { X += V.X; Y += V.Y; Z += V.Z; return *this; }
	FVector& operator-=(const FVector& V) { X -= V.X; Y -= V.Y; Z -= V.Z; return *this; }
	FVector& operator*=(double S) { X *= S; Y *= S; Z *= S; return *this; }
	/** Skalarprodukt (wie in Unreal: A | B) */
	double operator|(const FVector& V) const { return X * V.X + Y * V.Y + Z * V.Z; }
	/** Kreuzprodukt (wie in Unreal: A ^ B) */
	FVector operator^(const FVector& V) const { return FVector(Y * V.Z - Z * V.Y, Z * V.X - X * V.Z, X * V.Y - Y * V.X); }

	static FVector CrossProduct(const FVector& A, const FVector& B) { return A ^ B; }
	static double DotProduct(const FVector& A, const FVector& B) { return A | B; }
	double Size() const { return std::sqrt(X * X + Y * Y + Z * Z); }
	double SizeSquared() const { return X * X + Y * Y + Z * Z; }
	FVector GetSafeNormal(double Tolerance = 1e-8) const
	{
		const double S = SizeSquared();
		if (S == 1.0) return *this;
		if (S < Tolerance) return FVector(0.0, 0.0, 0.0);
		const double Scale = 1.0 / std::sqrt(S);
		return FVector(X * Scale, Y * Scale, Z * Scale);
	}
	static const FVector ZeroVector;
};
inline const FVector FVector::ZeroVector(0.0, 0.0, 0.0);
inline FVector operator*(double S, const FVector& V) { return V * S; }

struct FQuat
{
	double X = 0.0, Y = 0.0, Z = 0.0, W = 1.0;
	FQuat() = default;
	FQuat(double InX, double InY, double InZ, double InW) : X(InX), Y(InY), Z(InZ), W(InW) {}
	/** Drehung um eine Achse (Länge 1) um AngleRad */
	FQuat(const FVector& Axis, double AngleRad)
	{
		const double H = 0.5 * AngleRad;
		const double S = std::sin(H);
		X = S * Axis.X;
		Y = S * Axis.Y;
		Z = S * Axis.Z;
		W = std::cos(H);
	}
	/** A * B = zuerst B, dann A (Hamilton-Produkt) */
	FQuat operator*(const FQuat& B) const
	{
		return FQuat(
			W * B.X + X * B.W + Y * B.Z - Z * B.Y,
			W * B.Y - X * B.Z + Y * B.W + Z * B.X,
			W * B.Z + X * B.Y - Y * B.X + Z * B.W,
			W * B.W - X * B.X - Y * B.Y - Z * B.Z);
	}
	FVector RotateVector(const FVector& V) const
	{
		const FVector Q(X, Y, Z);
		const FVector T = (Q ^ V) * 2.0;
		return V + T * W + (Q ^ T);
	}
	void Normalize(double Tolerance = 1e-8)
	{
		const double S = X * X + Y * Y + Z * Z + W * W;
		if (S >= Tolerance)
		{
			const double Scale = 1.0 / std::sqrt(S);
			X *= Scale;
			Y *= Scale;
			Z *= Scale;
			W *= Scale;
		}
		else
		{
			*this = FQuat();
		}
	}
	FQuat GetNormalized() const
	{
		FQuat Q = *this;
		Q.Normalize();
		return Q;
	}
	/** Wie Unreal: kürzester Weg, bei sehr kleinem Winkel lineare Mischung, dann normalisieren */
	static FQuat Slerp(const FQuat& A, const FQuat& B, double Alpha)
	{
		const double RawCosom = A.X * B.X + A.Y * B.Y + A.Z * B.Z + A.W * B.W;
		const double Cosom = RawCosom >= 0.0 ? RawCosom : -RawCosom;
		double Scale0;
		double Scale1;
		if (Cosom < 0.9999)
		{
			const double Omega = std::acos(Cosom);
			const double InvSin = 1.0 / std::sin(Omega);
			Scale0 = std::sin((1.0 - Alpha) * Omega) * InvSin;
			Scale1 = std::sin(Alpha * Omega) * InvSin;
		}
		else
		{
			Scale0 = 1.0 - Alpha;
			Scale1 = Alpha;
		}
		Scale1 = RawCosom >= 0.0 ? Scale1 : -Scale1;
		FQuat R(Scale0 * A.X + Scale1 * B.X, Scale0 * A.Y + Scale1 * B.Y, Scale0 * A.Z + Scale1 * B.Z, Scale0 * A.W + Scale1 * B.W);
		R.Normalize();
		return R;
	}
};

struct FMath
{
	template <typename T>
	static T Clamp(T V, T A, T B) { return V < A ? A : (V < B ? V : B); }
	template <typename T>
	static T Min(T A, T B) { return A < B ? A : B; }
	template <typename T>
	static T Max(T A, T B) { return A < B ? B : A; }
	static double Abs(double V) { return std::fabs(V); }
	static double Sin(double V) { return std::sin(V); }
	static double Cos(double V) { return std::cos(V); }
	static double Atan2(double Y, double X) { return std::atan2(Y, X); }
	static double Asin(double V) { return std::asin(V); }
	static double Acos(double V) { return std::acos(V); }
	static double Sqrt(double V) { return std::sqrt(V); }
	static double Exp(double V) { return std::exp(V); }
	static double Fmod(double X, double Y) { return std::fmod(X, Y); }
	static float FRand()
	{
		static std::mt19937 Rng(1234);
		return std::uniform_real_distribution<float>(0.0f, 1.0f)(Rng);
	}
};
