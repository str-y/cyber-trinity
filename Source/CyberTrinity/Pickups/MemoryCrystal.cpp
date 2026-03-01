// Copyright 2024 Cyber Trinity. All Rights Reserved.
#include "Pickups/MemoryCrystal.h"
#include "Characters/AgentCharacter.h"
#include "Components/SphereComponent.h"
#include "Components/PointLightComponent.h"
#include "GameFramework/RotatingMovementComponent.h"
#include "NiagaraComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/World.h"

AMemoryCrystal::AMemoryCrystal()
{
    PrimaryActorTick.bCanEverTick = true;
    bReplicates = true;

    CrystalMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("CrystalMesh"));
    SetRootComponent(CrystalMesh);
    CrystalMesh->SetCollisionProfileName(TEXT("NoCollision"));

    PickupTrigger = CreateDefaultSubobject<USphereComponent>(TEXT("PickupTrigger"));
    PickupTrigger->SetupAttachment(CrystalMesh);
    PickupTrigger->SetSphereRadius(80.f);
    PickupTrigger->SetCollisionProfileName(TEXT("Trigger"));

    AmbientFX = CreateDefaultSubobject<UNiagaraComponent>(TEXT("AmbientFX"));
    AmbientFX->SetupAttachment(CrystalMesh);

    // Lumen-contributing point light (soft blue-white)
    CrystalLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("CrystalLight"));
    CrystalLight->SetupAttachment(CrystalMesh);
    CrystalLight->SetIntensity(4000.f);
    CrystalLight->SetAttenuationRadius(350.f);
    CrystalLight->SetLightColor(FLinearColor(0.7f, 0.85f, 1.0f));
    CrystalLight->bUseInverseSquaredFalloff = true;
    CrystalLight->CastShadows = false; // performance — ambient fill only

    // Gentle auto-rotation to draw the player's eye
    RotatingMovement = CreateDefaultSubobject<URotatingMovementComponent>(TEXT("RotatingMovement"));
    RotatingMovement->RotationRate = FRotator(0.f, 60.f, 20.f);
}

void AMemoryCrystal::BeginPlay()
{
    Super::BeginPlay();

    PickupTrigger->OnComponentBeginOverlap.AddDynamic(
        this, &AMemoryCrystal::OnPickupTriggerOverlap);

    // Create pulsing emissive material instance
    CrystalMID = CrystalMesh->CreateAndSetMaterialInstanceDynamic(0);
}

void AMemoryCrystal::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    if (bDelivered) return;

    PulseTime += DeltaTime;

    // Drive MI_MemoryCrystal's Pulse parameter (0–1 sine wave → emissive bloom)
    if (CrystalMID)
    {
        const float PulseValue = FMath::Sin(PulseTime * 3.0f) * 0.5f + 0.5f;
        CrystalMID->SetScalarParameterValue(TEXT("Pulse"), PulseValue);

        // Also drive light intensity for Lumen wet-floor reflection variance
        CrystalLight->SetIntensity(3000.f + PulseValue * 2000.f);
    }
}

// ── Pickup trigger ────────────────────────────────────────────────────────────

void AMemoryCrystal::OnPickupTriggerOverlap(UPrimitiveComponent* /*OverlappedComp*/,
                                            AActor* OtherActor,
                                            UPrimitiveComponent* /*OtherComp*/,
                                            int32 /*OtherBodyIndex*/,
                                            bool /*bFromSweep*/,
                                            const FHitResult& /*SweepResult*/)
{
    if (!IsFree()) return;

    if (AAgentCharacter* Agent = Cast<AAgentCharacter>(OtherActor))
    {
        if (!Agent->IsCarryingCrystal())
        {
            Agent->PickUpCrystal(this);
        }
    }
}

// ── State transitions ─────────────────────────────────────────────────────────

void AMemoryCrystal::OnPickedUp(AAgentCharacter* PickingAgent)
{
    CarrierAgent = PickingAgent;

    // Disable auto-rotation and ambient FX while being carried
    RotatingMovement->Deactivate();
    AmbientFX->Deactivate();
    PickupTrigger->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void AMemoryCrystal::OnDropped(const FVector& DropLocation)
{
    CarrierAgent = nullptr;
    SetActorLocation(DropLocation + FVector(0, 0, 50.f));

    RotatingMovement->Activate();
    AmbientFX->Activate(true);
    PickupTrigger->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
}

void AMemoryCrystal::OnDelivered()
{
    bDelivered = true;
    CarrierAgent = nullptr;

    AmbientFX->Deactivate();
    CrystalLight->SetVisibility(false);

    // Trigger data-dissolve material animation (Blueprint handles the timeline)
    if (CrystalMID)
    {
        CrystalMID->SetScalarParameterValue(TEXT("DissolveAmount"), 1.f);
    }

    // Hide after a short delay to allow dissolve animation to finish
    SetLifeSpan(1.5f);
}
