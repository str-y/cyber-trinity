// Copyright 2024 Cyber Trinity. All Rights Reserved.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "MemoryCrystal.generated.h"

class UNiagaraComponent;
class UStaticMeshComponent;
class USphereComponent;
class URotatingMovementComponent;

/**
 * A Memory Crystal — the primary objective pickup.
 *
 * Scattered across the battlefield as glowing multifaceted polyhedra.
 * Allied agents pick them up and deliver them to their faction's Data Node.
 *
 * Rendering:
 *   • SM_MemoryCrystal — custom Nanite geometry, translucent emissive material
 *     driven by MI_MemoryCrystal with a Pulse parameter
 *   • NS_CrystalAmbient — looping Niagara halo of data-stream sparks
 *   • Point light (Lumen) — contributes soft white-blue GI to wet floor
 *
 * On pick-up the crystal attaches to the carrier's hand socket and activates
 * the faction-colour carry trail (NS_CarryTrail).
 * On delivery a "data dissolve" material transition dissolves the mesh into
 * the faction's server rack / bionic tree / furnace core.
 */
UCLASS()
class CYBERTRINITY_API AMemoryCrystal : public AActor
{
    GENERATED_BODY()

public:
    AMemoryCrystal();

    // ── State ─────────────────────────────────────────────────────────────

    UFUNCTION(BlueprintPure, Category = "Crystal")
    bool IsFree() const { return CarrierAgent == nullptr && !bDelivered; }

    UFUNCTION(BlueprintPure, Category = "Crystal")
    bool IsDelivered() const { return bDelivered; }

    UFUNCTION(BlueprintPure, Category = "Crystal")
    class AAgentCharacter* GetCarrier() const { return CarrierAgent; }

    // ── Events (called by AAgentCharacter) ────────────────────────────────

    void OnPickedUp(class AAgentCharacter* PickingAgent);
    void OnDropped(const FVector& DropLocation);
    void OnDelivered();

protected:
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaTime) override;

    // ── Components ────────────────────────────────────────────────────────

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UStaticMeshComponent> CrystalMesh;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UNiagaraComponent> AmbientFX;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<class UPointLightComponent> CrystalLight;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<USphereComponent> PickupTrigger;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<URotatingMovementComponent> RotatingMovement;

private:
    UPROPERTY()
    TObjectPtr<class AAgentCharacter> CarrierAgent;

    bool bDelivered = false;
    float PulseTime = 0.f;

    TObjectPtr<UMaterialInstanceDynamic> CrystalMID;

    UFUNCTION()
    void OnPickupTriggerOverlap(UPrimitiveComponent* OverlappedComp,
                                AActor* OtherActor,
                                UPrimitiveComponent* OtherComp,
                                int32 OtherBodyIndex,
                                bool bFromSweep,
                                const FHitResult& SweepResult);
};
