// Der Drache, den der Spieler fliegt (Meilenstein 1: "Der Drache fliegt").
// Die Flugphysik rechnet FDragonFlightModel – genau wie das Browser-Spiel (getestet).
// Diese Klasse verbindet sie mit Unreal:
//  - Modell (Skeletal Mesh) und Kamera mit Federarm (folgt weich)
//  - Tasten und Gamepad (Enhanced Input, im Code angelegt – keine Assets nötig)
//  - Boden-Abfrage per Line Trace (Landschaft, Felsen, Dächer)
//  - Anzeige oben links: Tempo, Höhe, Ausdauer
// Umrechnung Unreal (cm, Z oben) ↔ Flugphysik (m, Y oben): Flight/DragonSpace.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "Flight/DragonFlightModel.h"
#include "DragonPawn.generated.h"

class USceneComponent;
class USkeletalMeshComponent;
class USpringArmComponent;
class UCameraComponent;
class UInputAction;
class UInputMappingContext;

UCLASS()
class DRAGONTWINUE_API ADragonPawn : public APawn
{
	GENERATED_BODY()

public:
	ADragonPawn();

	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	/** Flugphysik zum Lesen (z. B. für die Flügel-Animation in Meilenstein 1b) */
	const FDragonFlightModel& GetFlight() const { return Flight; }

protected:
	virtual void BeginPlay() override;

	/** Mittelpunkt des Drachen (= Position der Flugphysik) */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Drache")
	TObjectPtr<USceneComponent> Body;

	/** Das Drachen-Modell: im Blueprint das importierte "dragon_scales" einstellen */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Drache")
	TObjectPtr<USkeletalMeshComponent> DragonMesh;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Kamera")
	TObjectPtr<USpringArmComponent> CameraArm;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Kamera")
	TObjectPtr<UCameraComponent> Camera;

	/** Flughilfe wie im Browser-Spiel (aus = Loopings und Fassrollen von Hand) */
	UPROPERTY(EditAnywhere, Category = "Flug")
	bool bFlightAssist = true;

	/** Tempo beim Start (m/s) */
	UPROPERTY(EditAnywhere, Category = "Flug")
	double StartSpeed = 35.0;

	/** Kartenrand (m vom Mittelpunkt der Welt): dahinter lenkt die Flugphysik sanft zurück */
	UPROPERTY(EditAnywhere, Category = "Flug")
	double WorldRadius = 2850.0;

	/** Wind in Unreal-Richtung (m/s) */
	UPROPERTY(EditAnywhere, Category = "Flug")
	FVector Wind = FVector::ZeroVector;

	/** Oben links Tempo, Höhe und Ausdauer anzeigen */
	UPROPERTY(EditAnywhere, Category = "Anzeige")
	bool bShowFlightInfo = true;

private:
	FDragonFlightModel Flight;
	TUniquePtr<IDragonFlightWorld> WorldQuery;

	// Eingaben (werden im Code angelegt, siehe CreateInputActions)
	UPROPERTY()
	TObjectPtr<UInputMappingContext> InputContext;
	UPROPERTY()
	TObjectPtr<UInputAction> PitchKeys;
	UPROPERTY()
	TObjectPtr<UInputAction> RollKeys;
	UPROPERTY()
	TObjectPtr<UInputAction> PitchStick;
	UPROPERTY()
	TObjectPtr<UInputAction> RollStick;
	UPROPERTY()
	TObjectPtr<UInputAction> FlapAction;
	UPROPERTY()
	TObjectPtr<UInputAction> DiveAction;
	UPROPERTY()
	TObjectPtr<UInputAction> BoostAction;
	UPROPERTY()
	TObjectPtr<UInputAction> HoverAction;
	UPROPERTY()
	TObjectPtr<UInputAction> LandAction;

	bool bInputContextAdded = false;
	bool bFlapWasDown = false;
	bool bLandWasDown = false;
	bool bLanding = false; // Landeanflug läuft (Taste L)
	double KeyPitch = 0.0; // Tastatur-Achsen werden weich hochgefahren (wie im Browser-Spiel)
	double KeyRoll = 0.0;

	void CreateInputActions();
	void AddInputContext();
	FDragonFlightInput ReadInput(double Dt);
	void ShowFlightInfo() const;
};
