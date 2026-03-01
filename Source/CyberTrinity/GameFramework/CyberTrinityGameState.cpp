// Copyright 2024 Cyber Trinity. All Rights Reserved.
#include "GameFramework/CyberTrinityGameState.h"
#include "Net/UnrealNetwork.h"
#include "Engine/World.h"
#include "TimerManager.h"

ACyberTrinityGameState::ACyberTrinityGameState()
{
    PrimaryActorTick.bCanEverTick = true;
    bReplicates = true;

    // Initialise score slots: None(0), Archive(1), LifeForge(2), CoreProtocol(3)
    Scores.Init(0, 4);
    // Pre-seed scores per spec (30 / 85 / 55)
    Scores[static_cast<uint8>(EFaction::Archive)]      = 30;
    Scores[static_cast<uint8>(EFaction::LifeForge)]    = 85;
    Scores[static_cast<uint8>(EFaction::CoreProtocol)] = 55;
}

void ACyberTrinityGameState::BeginPlay()
{
    Super::BeginPlay();
}

void ACyberTrinityGameState::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    if (HasAuthority() && MatchTimeRemaining > 0.f)
    {
        MatchTimeRemaining = FMath::Max(0.f, MatchTimeRemaining - DeltaTime);
    }
}

void ACyberTrinityGameState::AddScore(EFaction Faction, int32 Points)
{
    if (!HasAuthority()) return;

    const int32 Idx = static_cast<int32>(Faction);
    if (!Scores.IsValidIndex(Idx)) return;

    Scores[Idx] += Points;
    OnScoreChanged.Broadcast(Faction, Scores[Idx]);

    if (!bNextFeatureCompleted &&
        Faction == NextFeatureFaction &&
        Scores[Idx] >= NextFeatureTriggerScore)
    {
        bNextFeatureCompleted = true;
        Scores[Idx] += NextFeatureBonusScore;
        OnScoreChanged.Broadcast(Faction, Scores[Idx]);

        const FText Msg = FText::Format(
            NSLOCTEXT("CyberTrinity", "NextFeatureComplete",
                "{0} completed ACTIVATE OVERCLOCK UPLINK (+{1})"),
            UEnum::GetDisplayValueAsText(Faction),
            FText::AsNumber(NextFeatureBonusScore)
        );
        OnEventFeedEntry.Broadcast(Msg);
    }

    CheckWinCondition();
}

int32 ACyberTrinityGameState::GetScore(EFaction Faction) const
{
    const int32 Idx = static_cast<int32>(Faction);
    return Scores.IsValidIndex(Idx) ? Scores[Idx] : 0;
}

EFaction ACyberTrinityGameState::GetLeadingFaction() const
{
    EFaction Leader = EFaction::None;
    int32 Best = -1;
    bool bTied = false;

    for (int32 i = 1; i < Scores.Num(); ++i)
    {
        if (Scores[i] > Best)
        {
            Best   = Scores[i];
            Leader = static_cast<EFaction>(i);
            bTied  = false;
        }
        else if (Scores[i] == Best)
        {
            bTied = true;
        }
    }
    return bTied ? EFaction::None : Leader;
}

void ACyberTrinityGameState::BroadcastEvent(const FText& Message, EFaction /*SourceFaction*/)
{
    if (!HasAuthority()) return;
    OnEventFeedEntry.Broadcast(Message);
}

void ACyberTrinityGameState::OnRep_Scores()
{
    // Notify HUD / Blueprint listeners for each faction
    for (int32 i = 1; i < Scores.Num(); ++i)
    {
        OnScoreChanged.Broadcast(static_cast<EFaction>(i), Scores[i]);
    }
}

void ACyberTrinityGameState::OnRep_MatchTimeRemaining()
{
    // Blueprint / UI can bind directly to MatchTimeRemaining
}

void ACyberTrinityGameState::OnRep_NextFeatureCompleted()
{
    // Blueprint / UI can bind directly to bNextFeatureCompleted
}

void ACyberTrinityGameState::CheckWinCondition()
{
    for (int32 i = 1; i < Scores.Num(); ++i)
    {
        if (Scores[i] >= ScoreLimit)
        {
            const FText Msg = FText::Format(
                NSLOCTEXT("CyberTrinity", "WinMsg", "{0} has reached {1} points — VICTORY!"),
                UEnum::GetDisplayValueAsText(static_cast<EFaction>(i)),
                FText::AsNumber(ScoreLimit)
            );
            OnEventFeedEntry.Broadcast(Msg);
            // Game mode handles formal match end; state only announces.
        }
    }
}

void ACyberTrinityGameState::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);
    DOREPLIFETIME(ACyberTrinityGameState, Scores);
    DOREPLIFETIME(ACyberTrinityGameState, MatchTimeRemaining);
    DOREPLIFETIME(ACyberTrinityGameState, bNextFeatureCompleted);
}
