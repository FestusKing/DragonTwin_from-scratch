#include "DragonPawn.h"

#include "Camera/CameraComponent.h"
#include "Components/SceneComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/Engine.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "Flight/DragonSpace.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputAction.h"
#include "InputCoreTypes.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"

// Eigener Namensraum: Unreal fasst beim Bauen mehrere .cpp-Dateien zusammen ("Unity Build").
namespace DragonPawnDetail
{
	/**
	 * Die Welt aus Sicht der Flugphysik: Boden per Line Trace von oben nach unten.
	 * Trifft alles, was "WorldStatic" ist: Landschaft, Felsen, Dächer.
	 * Gebäude von der Seite (Hindernisse) kommen in Meilenstein 3.
	 */
	class FUnrealFlightWorld final : public IDragonFlightWorld
	{
	public:
		FUnrealFlightWorld(UWorld* InWorld, const AActor* InIgnore) : World(InWorld), Ignore(InIgnore) {}

		virtual double GroundHeight(double X, double Z) const override
		{
			Trace(X, Z);
			return CachedHeight;
		}

		virtual FVector GroundNormal(double X, double Z) const override
		{
			Trace(X, Z);
			return CachedNormal;
		}

	private:
		UWorld* World = nullptr;
		const AActor* Ignore = nullptr;
		// Die Flugphysik fragt oft zweimal an derselben Stelle (Höhe, dann Normale) → merken
		mutable bool bHasCache = false;
		mutable double CachedX = 0.0;
		mutable double CachedZ = 0.0;
		mutable double CachedHeight = -1000.0;
		mutable FVector CachedNormal = FVector(0.0, 1.0, 0.0);

		void Trace(double X, double Z) const
		{
			if (bHasCache && X == CachedX && Z == CachedZ) return;
			bHasCache = true;
			CachedX = X;
			CachedZ = Z;
			const FVector Spot = DragonSpace::ToUnreal(FVector(X, 0.0, Z));
			const FVector Start(Spot.X, Spot.Y, 1000000.0); // 10 km über dem Meer
			const FVector End(Spot.X, Spot.Y, -1000000.0);
			FHitResult Hit;
			FCollisionQueryParams Params(FName(TEXT("DrachenBoden")), false, Ignore);
			if (World && World->LineTraceSingleByObjectType(Hit, Start, End, FCollisionObjectQueryParams(ECC_WorldStatic), Params))
			{
				CachedHeight = Hit.ImpactPoint.Z / DragonSpace::CmPerMeter;
				CachedNormal = DragonSpace::DirToPhysics(FVector(Hit.ImpactNormal)).GetSafeNormal();
			}
			else
			{
				CachedHeight = -1000.0; // kein Boden gefunden → wie tiefes Wasser
				CachedNormal = FVector(0.0, 1.0, 0.0);
			}
		}
	};

	UInputAction* MakeAction(UObject* Outer, const TCHAR* Name, EInputActionValueType Type)
	{
		UInputAction* Action = NewObject<UInputAction>(Outer, FName(Name));
		Action->ValueType = Type;
		return Action;
	}

	/** Taste zählt negativ (z. B. W = Nase runter = −1) */
	void Negate(UObject* Outer, FEnhancedActionKeyMapping& Mapping)
	{
		Mapping.Modifiers.Add(NewObject<UInputModifierNegate>(Outer));
	}
}

// ---------------------------------------------------------------------------
ADragonPawn::ADragonPawn()
{
	PrimaryActorTick.bCanEverTick = true;
	// Im Level platziert → der Spieler steuert diesen Drachen
	AutoPossessPlayer = EAutoReceiveInput::Player0;

	Body = CreateDefaultSubobject<USceneComponent>(TEXT("Koerper"));
	RootComponent = Body;

	DragonMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("DrachenModell"));
	DragonMesh->SetupAttachment(Body);
	DragonMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision); // die Flugphysik macht die Kollision

	CameraArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("KameraArm"));
	CameraArm->SetupAttachment(Body);
	CameraArm->TargetArmLength = 2600.0f;             // 26 m hinter dem Drachen
	CameraArm->SocketOffset = FVector(0.0, 0.0, 600.0); // 6 m höher
	CameraArm->SetRelativeRotation(FRotator(-10.0, 0.0, 0.0));
	CameraArm->bInheritRoll = false;                    // Horizont bleibt gerade
	CameraArm->bEnableCameraLag = true;
	CameraArm->CameraLagSpeed = 8.0f;
	CameraArm->bEnableCameraRotationLag = true;
	CameraArm->CameraRotationLagSpeed = 5.0f;
	CameraArm->bDoCollisionTest = true;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Kamera"));
	Camera->SetupAttachment(CameraArm, USpringArmComponent::SocketName);
	Camera->FieldOfView = 75.0f;
}

void ADragonPawn::BeginPlay()
{
	Super::BeginPlay();
	WorldQuery = MakeUnique<DragonPawnDetail::FUnrealFlightWorld>(GetWorld(), this);
	Flight.WorldRadius = WorldRadius;

	// Startpunkt und Blickrichtung aus dem Level übernehmen
	const FVector Ahead = DragonSpace::DirToPhysics(GetActorForwardVector());
	const double StartHeading = FMath::Atan2(-Ahead.X, -Ahead.Z);
	Flight.Reset(DragonSpace::ToPhysics(GetActorLocation()), StartHeading, StartSpeed);

	// Ereignisse: vorerst nur als Meldung (Töne, Staub und Kamera-Wackeln kommen später)
	Flight.OnLand = [this](bool bWater, double /*Into*/)
	{
		if (bShowFlightInfo && GEngine)
		{
			GEngine->AddOnScreenDebugMessage(-1, 2.0f, FColor::Green, bWater ? TEXT("Auf dem Wasser gelandet") : TEXT("Gelandet"));
		}
	};
	Flight.OnImpact = [this](double Strength, bool /*bWater*/)
	{
		if (bShowFlightInfo && GEngine)
		{
			GEngine->AddOnScreenDebugMessage(-1, 2.0f, FColor::Orange, FString::Printf(TEXT("Aufprall! (Stärke %.1f)"), Strength));
		}
	};
	Flight.OnTakeoff = [this]()
	{
		if (bShowFlightInfo && GEngine)
		{
			GEngine->AddOnScreenDebugMessage(-1, 2.0f, FColor::Cyan, TEXT("Abgehoben"));
		}
	};
}

// ---------------------------------------------------------------------------
void ADragonPawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	AddInputContext();
	if (!WorldQuery) return;

	FDragonFlightEnv Env;
	Env.World = WorldQuery.Get();
	Env.Wind = DragonSpace::DirToPhysics(Wind);
	Env.bAssist = bFlightAssist;
	Flight.WorldRadius = WorldRadius;
	Flight.Update(DeltaSeconds, ReadInput(DeltaSeconds), Env);

	SetActorLocationAndRotation(DragonSpace::ToUnreal(Flight.Position), DragonSpace::QuatToUnreal(Flight.Rotation));
	if (bShowFlightInfo) ShowFlightInfo();
}

void ADragonPawn::ShowFlightInfo() const
{
	if (!GEngine) return;
	const TCHAR* Mode = Flight.bGrounded ? TEXT("am Boden")
		: Flight.bHovering ? TEXT("schwebt")
		: Flight.bBoosting ? TEXT("Boost")
		: Flight.Fold > 0.5 ? TEXT("Sturzflug")
		: Flight.Speed < 14.0 ? TEXT("zu langsam!")
		: TEXT("fliegt");
	GEngine->AddOnScreenDebugMessage(1, 0.0f, FColor::White,
		FString::Printf(TEXT("Tempo %.0f km/h   Höhe %.0f m   Ausdauer %.0f %%   %s"),
			Flight.Speed * 3.6, Flight.Position.Y, Flight.Stamina * 100.0, Mode));
}

// ---------------------------------------------------------------------------
// Eingaben: gleiche Tasten wie im Browser-Spiel
void ADragonPawn::CreateInputActions()
{
	using namespace DragonPawnDetail;
	InputContext = NewObject<UInputMappingContext>(this, FName(TEXT("IMC_Drache")));
	PitchKeys = MakeAction(this, TEXT("IA_NickenTasten"), EInputActionValueType::Axis1D);
	RollKeys = MakeAction(this, TEXT("IA_RollenTasten"), EInputActionValueType::Axis1D);
	PitchStick = MakeAction(this, TEXT("IA_NickenStick"), EInputActionValueType::Axis1D);
	RollStick = MakeAction(this, TEXT("IA_RollenStick"), EInputActionValueType::Axis1D);
	FlapAction = MakeAction(this, TEXT("IA_Fluegelschlag"), EInputActionValueType::Boolean);
	DiveAction = MakeAction(this, TEXT("IA_Sturzflug"), EInputActionValueType::Boolean);
	BoostAction = MakeAction(this, TEXT("IA_Boost"), EInputActionValueType::Boolean);
	HoverAction = MakeAction(this, TEXT("IA_Schweben"), EInputActionValueType::Boolean);

	UInputMappingContext* C = InputContext;
	// Nicken: S / Pfeil runter = Nase hoch (+1), W / Pfeil hoch = Nase runter (−1)
	C->MapKey(PitchKeys, EKeys::S);
	C->MapKey(PitchKeys, EKeys::Down);
	Negate(this, C->MapKey(PitchKeys, EKeys::W));
	Negate(this, C->MapKey(PitchKeys, EKeys::Up));
	// Rollen: D / Pfeil rechts = rechts (+1), A / Pfeil links = links (−1)
	C->MapKey(RollKeys, EKeys::D);
	C->MapKey(RollKeys, EKeys::Right);
	Negate(this, C->MapKey(RollKeys, EKeys::A));
	Negate(this, C->MapKey(RollKeys, EKeys::Left));
	// Gamepad, linker Stick: nach vorne = Nase runter (wie im Flugzeug)
	Negate(this, C->MapKey(PitchStick, EKeys::Gamepad_LeftY));
	C->MapKey(RollStick, EKeys::Gamepad_LeftX);
	// Knöpfe (Gamepad wie im Browser-Spiel: A, B, RT, LT)
	C->MapKey(FlapAction, EKeys::SpaceBar);
	C->MapKey(FlapAction, EKeys::Gamepad_FaceButton_Bottom);
	C->MapKey(DiveAction, EKeys::LeftShift);
	C->MapKey(DiveAction, EKeys::RightShift);
	C->MapKey(DiveAction, EKeys::Gamepad_FaceButton_Right);
	C->MapKey(BoostAction, EKeys::E);
	C->MapKey(BoostAction, EKeys::LeftControl);
	C->MapKey(BoostAction, EKeys::Gamepad_RightTrigger);
	C->MapKey(HoverAction, EKeys::V);
	C->MapKey(HoverAction, EKeys::Gamepad_LeftTrigger);
}

void ADragonPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);
	if (!InputContext) CreateInputActions();
	UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!EIC)
	{
		UE_LOG(LogTemp, Error, TEXT("DragonPawn: Enhanced Input fehlt. Projekteinstellungen -> Input -> Default Input Component Class = EnhancedInputComponent"));
		return;
	}
	const TArray<UInputAction*> All = {PitchKeys.Get(), RollKeys.Get(), PitchStick.Get(), RollStick.Get(),
		FlapAction.Get(), DiveAction.Get(), BoostAction.Get(), HoverAction.Get()};
	for (UInputAction* Action : All)
	{
		EIC->BindActionValue(Action);
	}
}

void ADragonPawn::AddInputContext()
{
	if (bInputContextAdded || !InputContext) return;
	APlayerController* PC = Cast<APlayerController>(GetController());
	if (!PC) return;
	if (UEnhancedInputLocalPlayerSubsystem* Subsystem = ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
	{
		Subsystem->AddMappingContext(InputContext.Get(), 0);
		bInputContextAdded = true;
	}
}

FDragonFlightInput ADragonPawn::ReadInput(double Dt)
{
	FDragonFlightInput In;
	UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(InputComponent);
	if (!EIC || !InputContext) return In;

	auto Axis = [EIC](const UInputAction* Action) { return static_cast<double>(EIC->GetBoundActionValue(Action).Get<float>()); };
	auto Down = [EIC](const UInputAction* Action) { return EIC->GetBoundActionValue(Action).Get<bool>(); };
	// Tastatur-Achsen weich hochfahren (≈ 0.15 s) und schneller zurück – wie src/core/Input.js
	auto Approach = [Dt](double Cur, double Target)
	{
		const double Rate = (Target == 0.0 || FMath::Sign(Target) != FMath::Sign(Cur)) ? 10.0 : 6.5;
		const double D = Target - Cur;
		const double StepSize = Rate * Dt;
		return FMath::Abs(D) <= StepSize ? Target : Cur + FMath::Sign(D) * StepSize;
	};
	KeyPitch = Approach(KeyPitch, FMath::Clamp(Axis(PitchKeys), -1.0, 1.0));
	KeyRoll = Approach(KeyRoll, FMath::Clamp(Axis(RollKeys), -1.0, 1.0));
	In.Pitch = FMath::Clamp(KeyPitch + Axis(PitchStick), -1.0, 1.0);
	In.Roll = FMath::Clamp(KeyRoll + Axis(RollStick), -1.0, 1.0);
	In.bFlap = Down(FlapAction);
	In.bFlapPressed = In.bFlap && !bFlapWasDown;
	bFlapWasDown = In.bFlap;
	In.bDive = Down(DiveAction);
	In.bBoost = Down(BoostAction);
	In.bHover = Down(HoverAction);
	return In;
}
