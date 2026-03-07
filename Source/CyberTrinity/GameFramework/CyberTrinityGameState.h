// Copyright 2024 Cyber Trinity. All Rights Reserved.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameStateBase.h"
#include "Factions/FactionDefinition.h"
#include "CyberTrinityGameState.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnScoreChanged, EFaction, Faction, int32, NewScore);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnEventFeedEntry, const FText&, Message);

/**
 * Authoritative game state: tracks per-faction scores, in-flight event
 * messages, and the winning condition.
 *
 * Replicated to all clients so the holographic HUD stays in sync.
 */
UCLASS()
class CYBERTRINITY_API ACyberTrinityGameState : public AGameStateBase
{
    GENERATED_BODY()

public:
    ACyberTrinityGameState();

    // ── Delegates ─────────────────────────────────────────────────────────

    UPROPERTY(BlueprintAssignable, Category = "Events")
    FOnScoreChanged OnScoreChanged;

    UPROPERTY(BlueprintAssignable, Category = "Events")
    FOnEventFeedEntry OnEventFeedEntry;

    // ── Score API ─────────────────────────────────────────────────────────

    /** Called by the server when a crystal is delivered or an agent is killed. */
    UFUNCTION(BlueprintCallable, BlueprintAuthorityOnly, Category = "Score")
    void AddScore(EFaction Faction, int32 Points);

    UFUNCTION(BlueprintPure, Category = "Score")
    int32 GetScore(EFaction Faction) const;

    /** Returns the faction currently leading. EFaction::None if tied. */
    UFUNCTION(BlueprintPure, Category = "Score")
    EFaction GetLeadingFaction() const;

    // ── Event feed ────────────────────────────────────────────────────────

    /** Broadcasts a one-liner to all clients' event feeds. */
    UFUNCTION(BlueprintCallable, BlueprintAuthorityOnly, Category = "Events")
    void BroadcastEvent(const FText& Message, EFaction SourceFaction);

    // ── Match timer ───────────────────────────────────────────────────────

    UPROPERTY(ReplicatedUsing = OnRep_MatchTimeRemaining, BlueprintReadOnly, Category = "Match")
    float MatchTimeRemaining = 600.f; // 10-minute match

    UFUNCTION()
    void OnRep_MatchTimeRemaining();

    /** Score target — first faction to reach this score wins. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Match")
    int32 ScoreLimit = 200;

    // ── Next feature contract ───────────────────────────────────────────────

    // Archive maps to Blue in the browser preview implementation.
    UPROPERTY(Replicated, BlueprintReadOnly, Category = "Feature")
    EFaction NextFeatureFaction = EFaction::Archive;

    UPROPERTY(Replicated, BlueprintReadOnly, Category = "Feature")
    int32 NextFeatureTriggerScore = 100;

    UPROPERTY(Replicated, BlueprintReadOnly, Category = "Feature")
    int32 NextFeatureBonusScore = 15;

    UPROPERTY(Replicated, BlueprintReadOnly, Category = "Feature")
    FString NextFeatureActionName = TEXT("ACTIVATE OVERCLOCK UPLINK");

    UPROPERTY(ReplicatedUsing = OnRep_NextFeatureCompleted, BlueprintReadOnly, Category = "Feature")
    bool bNextFeatureCompleted = false;

    UPROPERTY(Replicated, BlueprintReadOnly, Category = "Feature")
    int32 NextFeatureIndex = 0;

    UPROPERTY(Replicated, BlueprintReadOnly, Category = "Feature")
    float NextFeatureVisualTimer = 0.f;

    UFUNCTION()
    void OnRep_NextFeatureCompleted();

    // ── Chaos Events (Map Events) ──────────────────────────────────────────

    /** Active chaos event type: "none", "emp_storm", "crystal_rain", "nexus_overload". */
    UPROPERTY(Replicated, BlueprintReadOnly, Category = "ChaosEvent")
    FString ChaosEventType = TEXT("none");

    /** Human-readable name of the active chaos event. */
    UPROPERTY(Replicated, BlueprintReadOnly, Category = "ChaosEvent")
    FString ChaosEventName;

    /** Seconds remaining for the active chaos event. */
    UPROPERTY(Replicated, BlueprintReadOnly, Category = "ChaosEvent")
    float ChaosEventRemaining = 0.f;

    /** World-space centre of the EMP Storm zone (only relevant when type is emp_storm). */
    UPROPERTY(Replicated, BlueprintReadOnly, Category = "ChaosEvent")
    FVector ChaosEventLocation = FVector::ZeroVector;

    /** Radius of the EMP Storm zone. */
    UPROPERTY(Replicated, BlueprintReadOnly, Category = "ChaosEvent")
    float ChaosEventRadius = 0.f;

    /** Countdown until the next chaos event fires. */
    float ChaosEventCooldown = 15.f;

    virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

protected:
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaTime) override;

private:
    /** Advances to the next contract after the completion visual window ends. */
    void AdvanceNextFeatureContract();
    /** Applies contract parameters (faction/trigger/bonus/action) for the given index. */
    void SetFeatureContractByIndex(int32 FeatureIndex);

    /** Selects and activates a random chaos event. */
    void TriggerRandomChaosEvent();

    // Scores indexed by EFaction (cast to uint8)
    UPROPERTY(ReplicatedUsing = OnRep_Scores)
    TArray<int32> Scores;

    UFUNCTION()
    void OnRep_Scores();

    void CheckWinCondition();
};
