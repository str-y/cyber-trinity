// Copyright 2024 Cyber Trinity. All Rights Reserved.
#include "GameFramework/CyberTrinitySpectatorPawn.h"
#include "Characters/AgentCharacter.h"
#include "EngineUtils.h"
#include "Engine/World.h"

ACyberTrinitySpectatorPawn::ACyberTrinitySpectatorPawn()
{
    PrimaryActorTick.bCanEverTick = true;
    bReplicates = true;
    bAddDefaultMovementBindings = true;
}

void ACyberTrinitySpectatorPawn::BeginPlay()
{
    Super::BeginPlay();
    if (!ObservedAgent)
    {
        CycleObservedAgent(1);
    }
}

void ACyberTrinitySpectatorPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    if (ObservedAgent && !ObservedAgent->IsAlive())
    {
        CycleObservedAgent(1);
    }

    UpdateFollowCamera(DeltaSeconds);
}

void ACyberTrinitySpectatorPawn::CycleObservedAgent(int32 Direction)
{
    TArray<AAgentCharacter*> Candidates;
    if (UWorld* World = GetWorld())
    {
        for (TActorIterator<AAgentCharacter> It(World); It; ++It)
        {
            if (It->IsAlive())
            {
                Candidates.Add(*It);
            }
        }
    }

    if (Candidates.Num() == 0)
    {
        ObservedAgent = nullptr;
        return;
    }

    int32 NextIndex = Candidates.IndexOfByKey(ObservedAgent);
    if (NextIndex == INDEX_NONE)
    {
        NextIndex = 0;
    }
    else
    {
        const int32 Step = Direction >= 0 ? 1 : -1;
        NextIndex = (NextIndex + Step + Candidates.Num()) % Candidates.Num();
    }

    ObserveAgent(Candidates[NextIndex]);
}

void ACyberTrinitySpectatorPawn::ObserveAgent(AAgentCharacter* Agent)
{
    ObservedAgent = Agent;
}

void ACyberTrinitySpectatorPawn::SetFreeCameraEnabled(bool bEnabled)
{
    bFreeCameraEnabled = bEnabled;
}

FText ACyberTrinitySpectatorPawn::GetObservedAgentLabel() const
{
    if (!ObservedAgent)
    {
        return NSLOCTEXT("CyberTrinity", "SpectatorNoAgent", "OVERHEAD CAMERA");
    }

    const int32 HealthPercent = FMath::RoundToInt(ObservedAgent->GetHealthPercent() * 100.f);
    return FText::Format(
        NSLOCTEXT("CyberTrinity", "SpectatorAgentLabel", "{0} · HP {1}%"),
        UEnum::GetDisplayValueAsText(ObservedAgent->GetFaction()),
        FText::AsNumber(HealthPercent));
}

float ACyberTrinitySpectatorPawn::GetObservedAbilityCooldown() const
{
    return ObservedAgent ? ObservedAgent->GetAbilityCooldownRemaining() : 0.f;
}

int32 ACyberTrinitySpectatorPawn::GetObservedCrystalCount() const
{
    return (ObservedAgent && ObservedAgent->IsCarryingCrystal()) ? 1 : 0;
}

void ACyberTrinitySpectatorPawn::UpdateFollowCamera(float DeltaSeconds)
{
    if (bFreeCameraEnabled || !ObservedAgent)
    {
        return;
    }

    const FVector FocusLocation = ObservedAgent->GetActorLocation();
    const FVector DesiredLocation = FocusLocation + FVector(-FollowDistance, 0.f, FollowHeight);
    const FRotator DesiredRotation = (FocusLocation - DesiredLocation).Rotation();

    const FVector NewLocation = FMath::VInterpTo(GetActorLocation(), DesiredLocation, DeltaSeconds, FollowInterpSpeed);
    const FRotator NewRotation = FMath::RInterpTo(GetActorRotation(), DesiredRotation, DeltaSeconds, FollowInterpSpeed);

    SetActorLocationAndRotation(NewLocation, NewRotation);
    if (Controller)
    {
        Controller->SetControlRotation(NewRotation);
    }
}
