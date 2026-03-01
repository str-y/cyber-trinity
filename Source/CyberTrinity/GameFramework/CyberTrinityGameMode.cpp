// Copyright 2024 Cyber Trinity. All Rights Reserved.
#include "GameFramework/CyberTrinityGameMode.h"
#include "GameFramework/CyberTrinityGameState.h"
#include "Characters/AgentCharacter.h"
#include "Factions/DataNode.h"
#include "Pickups/MemoryCrystal.h"
#include "EngineUtils.h"
#include "Engine/World.h"
#include "TimerManager.h"
#include "Kismet/GameplayStatics.h"
#include "NavigationSystem.h"

ACyberTrinityGameMode::ACyberTrinityGameMode()
{
    GameStateClass = ACyberTrinityGameState::StaticClass();
}

void ACyberTrinityGameMode::BeginPlay()
{
    Super::BeginPlay();
}

void ACyberTrinityGameMode::StartPlay()
{
    Super::StartPlay();
    SpawnAgents();
    SpawnCrystals();
}

// ── Agent spawning ────────────────────────────────────────────────────────────

void ACyberTrinityGameMode::SpawnAgents()
{
    UWorld* World = GetWorld();
    if (!World) return;

    const TArray<EFaction> Factions = {
        EFaction::Archive, EFaction::LifeForge, EFaction::CoreProtocol
    };

    for (EFaction Faction : Factions)
    {
        // Find the matching DataNode for spawn location
        ADataNode* Node = nullptr;
        for (TActorIterator<ADataNode> It(World); It; ++It)
        {
            if (It->GetFaction() == Faction)
            {
                Node = *It;
                break;
            }
        }

        if (!Node) continue;

        UFactionDefinition* FactionDef = GetFactionDefinition(Faction);
        if (!FactionDef) continue;

        for (int32 i = 0; i < AgentsPerFaction; ++i)
        {
            // Scatter around the node's spawn radius
            FVector SpawnLocation = Node->GetAgentSpawnLocation(i, AgentsPerFaction);
            FRotator SpawnRotation = FRotator::ZeroRotator;

            FActorSpawnParameters Params;
            Params.SpawnCollisionHandlingOverride =
                ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;

            AAgentCharacter* Agent = World->SpawnActor<AAgentCharacter>(
                AAgentCharacter::StaticClass(), SpawnLocation, SpawnRotation, Params);

            if (Agent)
            {
                Agent->InitialiseFaction(Faction, FactionDef);
            }
        }
    }
}

// ── Crystal spawning ──────────────────────────────────────────────────────────

void ACyberTrinityGameMode::SpawnCrystals()
{
    for (int32 i = 0; i < MaxActiveCrystals; ++i)
    {
        SpawnSingleCrystal();
    }
}

void ACyberTrinityGameMode::SpawnSingleCrystal()
{
    UWorld* World = GetWorld();
    if (!World) return;

    // Find a random navigable point on the battlefield
    UNavigationSystemV1* NavSys = FNavigationSystem::GetCurrent<UNavigationSystemV1>(World);
    FNavLocation RandomPoint;
    if (NavSys && NavSys->GetRandomPoint(RandomPoint))
    {
        FActorSpawnParameters Params;
        Params.SpawnCollisionHandlingOverride =
            ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;

        World->SpawnActor<AMemoryCrystal>(
            AMemoryCrystal::StaticClass(),
            RandomPoint.Location + FVector(0, 0, 50.f),
            FRotator::ZeroRotator,
            Params);

        ++ActiveCrystalCount;
    }
}

void ACyberTrinityGameMode::ScheduleCrystalRespawn()
{
    FTimerHandle TimerHandle;
    GetWorldTimerManager().SetTimer(
        TimerHandle,
        this,
        &ACyberTrinityGameMode::SpawnSingleCrystal,
        CrystalRespawnDelay,
        false);
}

// ── Match events ──────────────────────────────────────────────────────────────

void ACyberTrinityGameMode::HandleAgentKilled(
    AAgentCharacter* DeadAgent, AAgentCharacter* Killer)
{
    if (!DeadAgent) return;

    // Killer's faction gets a kill bonus
    if (Killer)
    {
        if (ACyberTrinityGameState* GS = GetGameState<ACyberTrinityGameState>())
        {
            GS->AddScore(Killer->GetFaction(), 5);
            FText Msg = FText::Format(
                NSLOCTEXT("CT", "Kill", "{0} eliminated {1}"),
                FText::FromString(UEnum::GetDisplayValueAsText(Killer->GetFaction()).ToString()),
                FText::FromString(UEnum::GetDisplayValueAsText(DeadAgent->GetFaction()).ToString())
            );
            GS->BroadcastEvent(Msg, Killer->GetFaction());
        }
    }

    // Schedule respawn
    FTimerHandle RespawnHandle;
    GetWorldTimerManager().SetTimer(
        RespawnHandle,
        FTimerDelegate::CreateUObject(this, &ACyberTrinityGameMode::RespawnAgent, DeadAgent),
        RespawnDelay,
        false);
}

void ACyberTrinityGameMode::HandleCrystalDelivered(
    EFaction DeliveryFaction, AAgentCharacter* Carrier)
{
    if (ACyberTrinityGameState* GS = GetGameState<ACyberTrinityGameState>())
    {
        const UFactionDefinition* Def = GetFactionDefinition(DeliveryFaction);
        const int32 Points = Def ? Def->CrystalDeliveryScore : 10;
        GS->AddScore(DeliveryFaction, Points);

        FText Msg = FText::Format(
            NSLOCTEXT("CT", "Crystal", "{0} agent delivered a Memory Crystal (+{1})"),
            FText::FromString(UEnum::GetDisplayValueAsText(DeliveryFaction).ToString()),
            FText::AsNumber(Points)
        );
        GS->BroadcastEvent(Msg, DeliveryFaction);
    }

    --ActiveCrystalCount;
    ScheduleCrystalRespawn();
}

void ACyberTrinityGameMode::RespawnAgent(AAgentCharacter* Agent)
{
    if (!Agent) return;

    // Teleport back to faction's Data Node
    UWorld* World = GetWorld();
    if (!World) return;

    for (TActorIterator<ADataNode> It(World); It; ++It)
    {
        if (It->GetFaction() == Agent->GetFaction())
        {
            FVector SpawnLoc = It->GetAgentSpawnLocation(0, 1);
            Agent->Respawn(SpawnLoc);
            break;
        }
    }
}

UFactionDefinition* ACyberTrinityGameMode::GetFactionDefinition(EFaction Faction) const
{
    switch (Faction)
    {
        case EFaction::Archive:      return ArchiveFaction;
        case EFaction::LifeForge:    return LifeForgeFaction;
        case EFaction::CoreProtocol: return CoreProtocolFaction;
        default: return nullptr;
    }
}
