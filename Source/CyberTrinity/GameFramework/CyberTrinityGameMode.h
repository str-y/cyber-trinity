// Copyright 2024 Cyber Trinity. All Rights Reserved.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "Factions/FactionDefinition.h"
#include "CyberTrinityGameMode.generated.h"

class APlayerController;
class APawn;

/**
 * Game mode for the 5v5v5 data-node combat match.
 *
 * Responsible for:
 *  • Spawning all 15 agents (5 per faction) at their Data Node
 *  • Managing the crystal respawn pool
 *  • Handling agent respawn after elimination
 *  • Calling ACyberTrinityGameState to update scores
 */
UCLASS()
class CYBERTRINITY_API ACyberTrinityGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    ACyberTrinityGameMode();

    // ── Configuration ─────────────────────────────────────────────────────

    /** Agents per faction. Spec: 5. Total players = AgentsPerFaction * 3. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Match")
    int32 AgentsPerFaction = 5;

    /** Time in seconds before a killed agent respawns at their Data Node. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Match")
    float RespawnDelay = 5.f;

    /** Total number of Memory Crystals alive on the battlefield at any time. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Crystals")
    int32 MaxActiveCrystals = 10;

    /** How long after delivery before a new crystal spawns to replace it. */
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Crystals")
    float CrystalRespawnDelay = 8.f;

    // ── Faction assets (set in editor) ────────────────────────────────────

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Factions")
    TObjectPtr<UFactionDefinition> ArchiveFaction;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Factions")
    TObjectPtr<UFactionDefinition> LifeForgeFaction;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Factions")
    TObjectPtr<UFactionDefinition> CoreProtocolFaction;

    // ── Runtime API ───────────────────────────────────────────────────────

    /** Called by AAgentCharacter when it is killed. Starts respawn timer. */
    UFUNCTION(BlueprintCallable, Category = "Match")
    void HandleAgentKilled(class AAgentCharacter* DeadAgent, class AAgentCharacter* Killer);

    /** Called by ADataNode when a crystal is delivered. Awards score. */
    UFUNCTION(BlueprintCallable, Category = "Match")
    void HandleCrystalDelivered(EFaction DeliveryFaction, class AAgentCharacter* Carrier);

    UFactionDefinition* GetFactionDefinition(EFaction Faction) const;

    UFUNCTION(BlueprintCallable, Category = "Spectator")
    void EnterSpectatorMode(class APlayerController* PlayerController);

    UFUNCTION(BlueprintCallable, Category = "Spectator")
    void ExitSpectatorMode(class APlayerController* PlayerController);

    UFUNCTION(BlueprintPure, Category = "Spectator")
    class ACyberTrinitySpectatorPawn* GetSpectatorPawn(class APlayerController* PlayerController) const;

protected:
    virtual void BeginPlay() override;
    virtual void StartPlay() override;

private:
    void SpawnAgents();
    void SpawnCrystals();
    void RespawnAgent(AAgentCharacter* Agent);
    void ScheduleCrystalRespawn();
    void SpawnSingleCrystal();

    int32 ActiveCrystalCount = 0;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Spectator", meta = (AllowPrivateAccess = "true"))
    TSubclassOf<class ACyberTrinitySpectatorPawn> SpectatorPawnClass;

    UPROPERTY(Transient)
    TMap<TObjectPtr<APlayerController>, TObjectPtr<APawn>> SavedPlayerPawns;
};
