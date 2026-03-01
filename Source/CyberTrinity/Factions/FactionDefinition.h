// Copyright 2024 Cyber Trinity. All Rights Reserved.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "FactionDefinition.generated.h"

/**
 * Identifies which of the three competing factions an actor belongs to.
 */
UENUM(BlueprintType)
enum class EFaction : uint8
{
    None        UMETA(DisplayName = "None"),
    Archive     UMETA(DisplayName = "The Archive  (Blue)"),   // Knowledge & Order
    LifeForge   UMETA(DisplayName = "Life Forge   (Green)"),  // Life & Harmony
    CoreProtocol UMETA(DisplayName = "Core Protocol (Red)"),  // Force & Chaos
};

/**
 * Data-only asset that centralises every faction-specific visual and gameplay
 * parameter. Create one instance per faction in the Content Browser.
 */
UCLASS(BlueprintType)
class CYBERTRINITY_API UFactionDefinition : public UPrimaryDataAsset
{
    GENERATED_BODY()

public:
    // ── Identity ──────────────────────────────────────────────────────────

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Identity")
    EFaction Faction = EFaction::None;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Identity")
    FText DisplayName;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Identity")
    FText Tagline;

    // ── Visuals ───────────────────────────────────────────────────────────

    /** Primary neon colour used on armour lines, glow FX, and HUD elements. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Visuals")
    FLinearColor PrimaryColor = FLinearColor::White;

    /** Emissive multiplier applied to armour neon lines (HDR > 1 for bloom). */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Visuals")
    float EmissiveIntensity = 8.f;

    /** Holographic shield tint for the Data Node force-field. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Visuals")
    FLinearColor ShieldColor = FLinearColor::White;

    // ── Gameplay ──────────────────────────────────────────────────────────

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gameplay")
    float AgentMoveSpeed = 600.f;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gameplay")
    float AgentMaxHealth = 200.f;

    /** Base damage dealt per melee / ranged hit before modifiers. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gameplay")
    float BaseDamage = 30.f;

    /** Score awarded when a Memory Crystal is delivered to the Data Node. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gameplay")
    int32 CrystalDeliveryScore = 10;

    // ── Niagara FX ────────────────────────────────────────────────────────

    /** Looping ambient particle system emitted around the Data Node base. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FX")
    TSoftObjectPtr<class UNiagaraSystem> BaseAmbientFX;

    /** Trail emitted while an agent is carrying a Memory Crystal. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FX")
    TSoftObjectPtr<class UNiagaraSystem> CarryTrailFX;

    /** Burst played on agent death. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FX")
    TSoftObjectPtr<class UNiagaraSystem> DeathBurstFX;

    // ── Audio ─────────────────────────────────────────────────────────────

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Audio")
    TSoftObjectPtr<class USoundBase> CrystalDeliverySound;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Audio")
    TSoftObjectPtr<class USoundBase> AgentDeathSound;
};
