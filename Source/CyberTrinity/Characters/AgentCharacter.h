// Copyright 2024 Cyber Trinity. All Rights Reserved.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "Factions/FactionDefinition.h"
#include "AgentCharacter.generated.h"

class UNiagaraComponent;
class UCapsuleComponent;

/**
 * Base class for all 15 agents (5 × 3 factions).
 *
 * Each faction has a Blueprint subclass that overrides meshes, abilities, and
 * animation blueprints:
 *   BP_DataSniper   (Archive / Blue)   — long-range energy rifle, high-ground
 *   BP_BioGuard     (LifeForge / Green) — shield wall, close-range AoE heal
 *   BP_CoreStriker  (CoreProtocol / Red) — power-fist dash, highest speed
 *
 * AI is driven by AAgentAIController, which uses a Behaviour Tree and
 * Environment Query System (EQS) to choose between:
 *   • Roaming the battlefield
 *   • Picking up a nearby Memory Crystal
 *   • Delivering a crystal to the faction's Data Node
 *   • Attacking an enemy agent or enemy Data Node
 */
UCLASS(Abstract)
class CYBERTRINITY_API AAgentCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    AAgentCharacter();

    // ── Faction setup ─────────────────────────────────────────────────────

    /** Called by game mode after spawn to bind faction colour, stats, FX. */
    UFUNCTION(BlueprintCallable, Category = "Faction")
    void InitialiseFaction(EFaction InFaction, UFactionDefinition* InDef);

    UFUNCTION(BlueprintPure, Category = "Faction")
    EFaction GetFaction() const { return Faction; }

    UFUNCTION(BlueprintPure, Category = "Faction")
    UFactionDefinition* GetFactionDefinition() const { return FactionDef; }

    // ── Health ────────────────────────────────────────────────────────────

    UFUNCTION(BlueprintCallable, Category = "Combat")
    void TakeDamageFromAgent(float Damage, AAgentCharacter* Attacker);

    UFUNCTION(BlueprintPure, Category = "Combat")
    bool IsAlive() const { return Health > 0.f; }

    UFUNCTION(BlueprintPure, Category = "Combat")
    float GetHealthPercent() const;

    /** Teleport back to base and restore full health (called by game mode). */
    UFUNCTION(BlueprintCallable, Category = "Combat")
    void Respawn(const FVector& SpawnLocation);

    // ── Crystal carrying ──────────────────────────────────────────────────

    UFUNCTION(BlueprintCallable, Category = "Crystal")
    void PickUpCrystal(class AMemoryCrystal* Crystal);

    UFUNCTION(BlueprintCallable, Category = "Crystal")
    void DropCrystal();

    UFUNCTION(BlueprintPure, Category = "Crystal")
    bool IsCarryingCrystal() const { return CarriedCrystal != nullptr; }

    UFUNCTION(BlueprintPure, Category = "Crystal")
    AMemoryCrystal* GetCarriedCrystal() const { return CarriedCrystal; }

    // ── Ability ───────────────────────────────────────────────────────────

    /** Faction-specific special ability — overridden in Blueprint subclasses. */
    UFUNCTION(BlueprintImplementableEvent, Category = "Ability")
    void ActivateSpecialAbility();

    /**
     * Attempt to activate the faction ability if cooldown is ready and
     * energy is sufficient.  Returns true on success.
     */
    UFUNCTION(BlueprintCallable, Category = "Ability")
    bool TryActivateAbility();

    UFUNCTION(BlueprintPure, Category = "Ability")
    float GetAbilityCooldownRemaining() const { return AbilityCooldownRemaining; }

    UFUNCTION(BlueprintPure, Category = "Ability")
    float GetAbilityCooldownMax() const { return AbilityCooldownMax; }

    UFUNCTION(BlueprintPure, Category = "Ability")
    float GetEnergy() const { return Energy; }

    UFUNCTION(BlueprintPure, Category = "Ability")
    float GetMaxEnergy() const { return MaxEnergy; }

    // ── Neon armour visuals ───────────────────────────────────────────────

    /** Dynamic material instance index on the armour mesh that carries the neon line emissive. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Visuals")
    int32 NeonLineMaterialIndex = 1;

protected:
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaTime) override;

    // ── Components ────────────────────────────────────────────────────────

    /** Niagara component for the neon trail while carrying a crystal. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "FX")
    TObjectPtr<UNiagaraComponent> TrailFX;

    /** Looping ambient glow emitter attached to the agent's torso. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "FX")
    TObjectPtr<UNiagaraComponent> ArmourGlowFX;

    // ── State ─────────────────────────────────────────────────────────────

    UPROPERTY(BlueprintReadOnly, Category = "Combat")
    float Health = 200.f;

    UPROPERTY(BlueprintReadOnly, Category = "Combat")
    float MaxHealth = 200.f;

    UPROPERTY(BlueprintReadOnly, Category = "Ability")
    float AbilityCooldownRemaining = 0.f;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ability")
    float AbilityCooldownMax = 8.f;

    UPROPERTY(BlueprintReadOnly, Category = "Ability")
    float Energy = 100.f;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ability")
    float MaxEnergy = 100.f;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ability")
    float AbilityEnergyCost = 30.f;

    /** Energy regenerated per second while alive. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Ability")
    float EnergyRegenRate = 8.f;

private:
    UPROPERTY()
    EFaction Faction = EFaction::None;

    UPROPERTY()
    TObjectPtr<UFactionDefinition> FactionDef;

    UPROPERTY()
    TObjectPtr<AMemoryCrystal> CarriedCrystal;

    TObjectPtr<UMaterialInstanceDynamic> NeonLineMID;

    void ApplyFactionVisuals();
    void Die(AAgentCharacter* Killer);
};
