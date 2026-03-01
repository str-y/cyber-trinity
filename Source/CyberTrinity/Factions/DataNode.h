// Copyright 2024 Cyber Trinity. All Rights Reserved.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Factions/FactionDefinition.h"
#include "DataNode.generated.h"

class UNiagaraComponent;
class USphereComponent;
class UPointLightComponent;

/**
 * The faction headquarters — called a "Data Node" in-world.
 *
 * Three instances exist in the level (one per faction), placed in a triangular
 * arrangement. Each node:
 *   • Displays an animated holographic shield dome (Niagara)
 *   • Emits Lumen-lit volumetric point lights in faction colour
 *   • Accepts Memory Crystal deliveries from allied agents
 *   • Visually streams incoming crystals into the server rack / bionic tree /
 *     furnace core via a "data dissolve" material effect
 *
 * The level Blueprint (BP_CyberTrinityLevel) wires network-link splines
 * between the three nodes.
 */
UCLASS()
class CYBERTRINITY_API ADataNode : public AActor
{
    GENERATED_BODY()

public:
    ADataNode();

    // ── Faction ───────────────────────────────────────────────────────────

    UPROPERTY(EditInstanceOnly, BlueprintReadWrite, Category = "Faction")
    EFaction NodeFaction = EFaction::None;

    UPROPERTY(EditInstanceOnly, BlueprintReadOnly, Category = "Faction")
    TObjectPtr<UFactionDefinition> FactionDef;

    UFUNCTION(BlueprintPure, Category = "Faction")
    EFaction GetFaction() const { return NodeFaction; }

    // ── Crystal delivery ──────────────────────────────────────────────────

    /**
     * Called when an allied agent overlaps the delivery sphere while
     * carrying a Memory Crystal.
     */
    UFUNCTION(BlueprintCallable, Category = "Crystal")
    void AcceptCrystalDelivery(class AAgentCharacter* Carrier);

    /** Returns a world-space spawn point for the i-th agent of n total. */
    UFUNCTION(BlueprintPure, Category = "Spawn")
    FVector GetAgentSpawnLocation(int32 AgentIndex, int32 TotalAgents) const;

    // ── Shield state ──────────────────────────────────────────────────────

    UPROPERTY(BlueprintReadOnly, Category = "Shield")
    float ShieldHealth = 1000.f;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Shield")
    float MaxShieldHealth = 1000.f;

    UFUNCTION(BlueprintCallable, Category = "Shield")
    void DamageShield(float Damage);

    UFUNCTION(BlueprintPure, Category = "Shield")
    float GetShieldPercent() const;

    // ── Crystals stored ───────────────────────────────────────────────────

    UPROPERTY(BlueprintReadOnly, Category = "Crystal")
    int32 CrystalsDelivered = 0;

protected:
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaTime) override;

    // ── Components ────────────────────────────────────────────────────────

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UStaticMeshComponent> BaseMesh;

    /** Holographic dome shield — animated Niagara system. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UNiagaraComponent> ShieldFX;

    /** Faction-coloured area light — contributes to Lumen GI. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UPointLightComponent> FactionLight;

    /** Sphere trigger for crystal delivery detection. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<USphereComponent> DeliveryZone;

    /** Ambient data-stream Niagara system looping around the node. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UNiagaraComponent> DataStreamFX;

private:
    UFUNCTION()
    void OnDeliveryZoneOverlap(UPrimitiveComponent* OverlappedComp,
                               AActor* OtherActor,
                               UPrimitiveComponent* OtherComp,
                               int32 OtherBodyIndex,
                               bool bFromSweep,
                               const FHitResult& SweepResult);

    float ShieldPulseTime = 0.f;
    void ApplyFactionLighting();
    void UpdateShieldMaterial();
};
