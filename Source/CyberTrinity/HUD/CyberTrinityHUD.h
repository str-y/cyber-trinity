// Copyright 2024 Cyber Trinity. All Rights Reserved.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "Factions/FactionDefinition.h"
#include "CyberTrinityHUD.generated.h"

class UUserWidget;
class UCyberTrinityHUDWidget;

/**
 * Minimal interface that the HUD widget Blueprint must implement.
 * Keeps the C++ ↔ UMG boundary type-safe.
 */
UINTERFACE(MinimalAPI, Blueprintable)
class UCyberTrinityHUDInterface : public UInterface
{
    GENERATED_BODY()
};

class CYBERTRINITY_API ICyberTrinityHUDInterface
{
    GENERATED_BODY()
public:
    /** Called when a faction score changes. */
    UFUNCTION(BlueprintImplementableEvent, Category = "HUD")
    void OnScoreUpdated(EFaction Faction, int32 NewScore);

    /** Called when a new event-feed line should be displayed. */
    UFUNCTION(BlueprintImplementableEvent, Category = "HUD")
    void OnEventFeedEntry(const FText& Message);
};

/**
 * HUD actor — owns and manages the main holographic overlay widget.
 *
 * The widget (W_CyberTrinityHUD) is a UMG Blueprint that implements
 * UCyberTrinityHUDInterface with three zones:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  [Faction Legend]   [ARCHIVE 30 | LIFE FORGE 85 | CORE 55]  │  Top
 *   │                                          [💎 Crystals: 7]   │
 *   │                                          [Event feed…]      │  Right
 *   │                                                              │
 *   │  [Agent Status]                [Ability / Cooldown]         │  Bottom
 *   └──────────────────────────────────────────────────────────────┘
 *
 * All elements use semi-transparent holographic materials with neon glow
 * post-process. The score values are driven by ACyberTrinityGameState delegates.
 */
UCLASS()
class CYBERTRINITY_API ACyberTrinityHUD : public AHUD
{
    GENERATED_BODY()

public:
    ACyberTrinityHUD();

    virtual void BeginPlay() override;
    virtual void DrawHUD() override;

    // ── Widget class (set in Blueprint subclass) ──────────────────────────

    UPROPERTY(EditDefaultsOnly, Category = "HUD")
    TSubclassOf<UUserWidget> HUDWidgetClass;

    /** Returns the main HUD widget (for external binding). */
    UFUNCTION(BlueprintPure, Category = "HUD")
    UUserWidget* GetHUDWidget() const { return HUDWidget; }

    // ── Score display ─────────────────────────────────────────────────────

    /** Refreshes the three faction score labels. Called by game state delegate. */
    UFUNCTION(BlueprintCallable, Category = "HUD")
    void UpdateScoreDisplay(EFaction Faction, int32 NewScore);

    /** Pushes a new line to the rolling event feed. */
    UFUNCTION(BlueprintCallable, Category = "HUD")
    void PushEventFeedEntry(const FText& Message);

protected:
    UPROPERTY()
    TObjectPtr<UUserWidget> HUDWidget;

private:
    void BindToGameState();
};
