// Copyright 2024 Cyber Trinity. All Rights Reserved.
#include "Characters/AgentCharacter.h"
#include "Pickups/MemoryCrystal.h"
#include "GameFramework/CyberTrinityGameMode.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "Engine/World.h"

AAgentCharacter::AAgentCharacter()
{
    PrimaryActorTick.bCanEverTick = true;
    bReplicates = true;

    TrailFX = CreateDefaultSubobject<UNiagaraComponent>(TEXT("TrailFX"));
    TrailFX->SetupAttachment(GetRootComponent());
    TrailFX->SetAutoActivate(false);

    ArmourGlowFX = CreateDefaultSubobject<UNiagaraComponent>(TEXT("ArmourGlowFX"));
    ArmourGlowFX->SetupAttachment(GetMesh(), TEXT("spine_03"));
    ArmourGlowFX->SetAutoActivate(false);
}

void AAgentCharacter::BeginPlay()
{
    Super::BeginPlay();

    if (FactionDef)
    {
        Health = MaxHealth = FactionDef->AgentMaxHealth;
        ApplyFactionVisuals();
    }
}

void AAgentCharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    if (AbilityCooldownRemaining > 0.f)
    {
        AbilityCooldownRemaining = FMath::Max(0.f, AbilityCooldownRemaining - DeltaTime);
    }

    // Energy regeneration
    if (IsAlive() && Energy < MaxEnergy)
    {
        Energy = FMath::Min(MaxEnergy, Energy + EnergyRegenRate * DeltaTime);
    }

    // Keep carried crystal glued to agent's hand socket
    if (CarriedCrystal)
    {
        const FVector HandLoc = GetMesh()->GetSocketLocation(TEXT("hand_r"));
        CarriedCrystal->SetActorLocation(HandLoc + FVector(0, 0, 20.f));
    }
}

// ── Faction setup ─────────────────────────────────────────────────────────────

void AAgentCharacter::InitialiseFaction(EFaction InFaction, UFactionDefinition* InDef)
{
    Faction    = InFaction;
    FactionDef = InDef;

    if (FactionDef)
    {
        Health = MaxHealth = FactionDef->AgentMaxHealth;
        GetCharacterMovement()->MaxWalkSpeed = FactionDef->AgentMoveSpeed;
        ApplyFactionVisuals();
    }
}

void AAgentCharacter::ApplyFactionVisuals()
{
    if (!FactionDef) return;

    USkeletalMeshComponent* Mesh = GetMesh();
    if (!Mesh) return;

    // Create a dynamic material instance for the neon armour line slot
    NeonLineMID = Mesh->CreateAndSetMaterialInstanceDynamic(NeonLineMaterialIndex);
    if (NeonLineMID)
    {
        NeonLineMID->SetVectorParameterValue(TEXT("NeonColor"), FactionDef->PrimaryColor);
        NeonLineMID->SetScalarParameterValue(TEXT("EmissiveIntensity"), FactionDef->EmissiveIntensity);
    }

    // Activate ambient armour glow
    if (FactionDef->CarryTrailFX.IsValid())
    {
        ArmourGlowFX->SetAsset(FactionDef->CarryTrailFX.Get());
        ArmourGlowFX->Activate(true);
    }
}

// ── Health / Combat ───────────────────────────────────────────────────────────

void AAgentCharacter::TakeDamageFromAgent(float Damage, AAgentCharacter* Attacker)
{
    if (!IsAlive()) return;

    Health = FMath::Max(0.f, Health - Damage);

    if (!IsAlive())
    {
        Die(Attacker);
    }
}

float AAgentCharacter::GetHealthPercent() const
{
    return MaxHealth > 0.f ? Health / MaxHealth : 0.f;
}

void AAgentCharacter::Die(AAgentCharacter* Killer)
{
    DropCrystal();

    // Disable collision and movement while dead
    GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    GetCharacterMovement()->DisableMovement();
    SetActorHiddenInGame(true);

    if (ACyberTrinityGameMode* GM = GetWorld()->GetAuthGameMode<ACyberTrinityGameMode>())
    {
        GM->HandleAgentKilled(this, Killer);
    }
}

void AAgentCharacter::Respawn(const FVector& SpawnLocation)
{
    Health = MaxHealth;
    Energy = MaxEnergy;
    SetActorLocation(SpawnLocation);
    SetActorHiddenInGame(false);
    GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
    GetCharacterMovement()->SetMovementMode(MOVE_Walking);
}

// ── Ability ───────────────────────────────────────────────────────────────────

bool AAgentCharacter::TryActivateAbility()
{
    if (!IsAlive()) return false;
    if (AbilityCooldownRemaining > 0.f) return false;
    if (Energy < AbilityEnergyCost) return false;

    Energy -= AbilityEnergyCost;
    AbilityCooldownRemaining = AbilityCooldownMax;

    // Dispatch to faction-specific Blueprint implementation
    ActivateSpecialAbility();
    return true;
}

// ── Crystal ───────────────────────────────────────────────────────────────────

void AAgentCharacter::PickUpCrystal(AMemoryCrystal* Crystal)
{
    if (!Crystal || CarriedCrystal) return;

    CarriedCrystal = Crystal;
    Crystal->OnPickedUp(this);

    // Enable the neon carry trail
    if (FactionDef && FactionDef->CarryTrailFX.IsValid())
    {
        TrailFX->SetAsset(FactionDef->CarryTrailFX.Get());
        TrailFX->Activate(true);
    }
}

void AAgentCharacter::DropCrystal()
{
    if (!CarriedCrystal) return;

    CarriedCrystal->OnDropped(GetActorLocation());
    CarriedCrystal = nullptr;
    TrailFX->Deactivate();
}
