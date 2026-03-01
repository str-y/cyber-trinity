// Copyright 2024 Cyber Trinity. All Rights Reserved.
#include "Factions/DataNode.h"
#include "Characters/AgentCharacter.h"
#include "GameFramework/CyberTrinityGameMode.h"
#include "Components/SphereComponent.h"
#include "Components/PointLightComponent.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/World.h"
#include "Math/UnrealMathUtility.h"

ADataNode::ADataNode()
{
    PrimaryActorTick.bCanEverTick = true;

    BaseMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BaseMesh"));
    SetRootComponent(BaseMesh);

    DeliveryZone = CreateDefaultSubobject<USphereComponent>(TEXT("DeliveryZone"));
    DeliveryZone->SetupAttachment(BaseMesh);
    DeliveryZone->SetSphereRadius(200.f);
    DeliveryZone->SetCollisionProfileName(TEXT("Trigger"));

    ShieldFX = CreateDefaultSubobject<UNiagaraComponent>(TEXT("ShieldFX"));
    ShieldFX->SetupAttachment(BaseMesh);

    FactionLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("FactionLight"));
    FactionLight->SetupAttachment(BaseMesh);
    FactionLight->SetIntensity(50000.f);      // HDR for Lumen
    FactionLight->SetAttenuationRadius(1200.f);
    FactionLight->bUseInverseSquaredFalloff = true;
    FactionLight->CastShadows = true;

    DataStreamFX = CreateDefaultSubobject<UNiagaraComponent>(TEXT("DataStreamFX"));
    DataStreamFX->SetupAttachment(BaseMesh);
}

void ADataNode::BeginPlay()
{
    Super::BeginPlay();

    DeliveryZone->OnComponentBeginOverlap.AddDynamic(
        this, &ADataNode::OnDeliveryZoneOverlap);

    if (FactionDef)
    {
        ApplyFactionLighting();
    }
}

void ADataNode::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    // Animate shield pulse via material parameter
    ShieldPulseTime += DeltaTime;
    UpdateShieldMaterial();
}

// ── Crystal delivery ──────────────────────────────────────────────────────────

void ADataNode::OnDeliveryZoneOverlap(UPrimitiveComponent* /*OverlappedComp*/,
                                      AActor* OtherActor,
                                      UPrimitiveComponent* /*OtherComp*/,
                                      int32 /*OtherBodyIndex*/,
                                      bool /*bFromSweep*/,
                                      const FHitResult& /*SweepResult*/)
{
    AAgentCharacter* Agent = Cast<AAgentCharacter>(OtherActor);
    if (Agent && Agent->GetFaction() == NodeFaction && Agent->IsCarryingCrystal())
    {
        AcceptCrystalDelivery(Agent);
    }
}

void ADataNode::AcceptCrystalDelivery(AAgentCharacter* Carrier)
{
    if (!Carrier) return;

    ++CrystalsDelivered;

    // Play a one-shot delivery burst at the node
    if (FactionDef && FactionDef->DeathBurstFX.IsValid())
    {
        UNiagaraFunctionLibrary::SpawnSystemAtLocation(
            GetWorld(),
            FactionDef->DeathBurstFX.Get(),
            GetActorLocation(),
            FRotator::ZeroRotator,
            FVector(1.f),
            true, true);
    }

    // Drop crystal from carrier and notify game mode
    Carrier->DropCrystal();

    if (ACyberTrinityGameMode* GM = GetWorld()->GetAuthGameMode<ACyberTrinityGameMode>())
    {
        GM->HandleCrystalDelivered(NodeFaction, Carrier);
    }
}

// ── Shield ────────────────────────────────────────────────────────────────────

void ADataNode::DamageShield(float Damage)
{
    ShieldHealth = FMath::Max(0.f, ShieldHealth - Damage);
}

float ADataNode::GetShieldPercent() const
{
    return MaxShieldHealth > 0.f ? ShieldHealth / MaxShieldHealth : 0.f;
}

void ADataNode::UpdateShieldMaterial()
{
    // Drive shield Niagara float parameter for pulse effect
    if (ShieldFX)
    {
        const float Pulse = FMath::Sin(ShieldPulseTime * 1.6f) * 0.5f + 0.5f;
        ShieldFX->SetFloatParameter(TEXT("ShieldPulse"), Pulse);
        ShieldFX->SetFloatParameter(TEXT("ShieldHealth"), GetShieldPercent());
    }
}

// ── Faction lighting ──────────────────────────────────────────────────────────

void ADataNode::ApplyFactionLighting()
{
    if (!FactionDef) return;

    // Tint the Lumen-aware point light with faction colour
    FactionLight->SetLightColor(FactionDef->PrimaryColor);

    // Pass colour to shield Niagara system
    if (ShieldFX)
    {
        ShieldFX->SetColorParameter(TEXT("ShieldColor"), FactionDef->ShieldColor);
    }
    if (DataStreamFX)
    {
        DataStreamFX->SetColorParameter(TEXT("StreamColor"), FactionDef->PrimaryColor);
    }
}

// ── Spawn helpers ─────────────────────────────────────────────────────────────

FVector ADataNode::GetAgentSpawnLocation(int32 AgentIndex, int32 TotalAgents) const
{
    const float SpawnRadius = 220.f;
    const float AngleStep   = (TotalAgents > 1) ? (2.f * PI / TotalAgents) : 0.f;
    const float Angle       = AgentIndex * AngleStep;
    return GetActorLocation()
        + FVector(FMath::Cos(Angle) * SpawnRadius,
                  FMath::Sin(Angle) * SpawnRadius,
                  90.f);
}
