// Copyright 2024 Cyber Trinity. All Rights Reserved.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SpectatorPawn.h"
#include "CyberTrinitySpectatorPawn.generated.h"

class AAgentCharacter;

/**
 * Free-flying spectator pawn with optional agent follow lock.
 *
 * Supports:
 *  • Cycling through live agents for e-sports style follow cams
 *  • Releasing back to a free camera without affecting the match
 *  • Exposing observed-agent HUD data to Blueprints / UMG
 */
UCLASS()
class CYBERTRINITY_API ACyberTrinitySpectatorPawn : public ASpectatorPawn
{
    GENERATED_BODY()

public:
    ACyberTrinitySpectatorPawn();

    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;

    UFUNCTION(BlueprintCallable, Category = "Spectator")
    void CycleObservedAgent(int32 Direction = 1);

    UFUNCTION(BlueprintCallable, Category = "Spectator")
    void ObserveAgent(AAgentCharacter* Agent);

    UFUNCTION(BlueprintCallable, Category = "Spectator")
    void SetFreeCameraEnabled(bool bEnabled);

    UFUNCTION(BlueprintPure, Category = "Spectator")
    bool IsFreeCameraEnabled() const { return bFreeCameraEnabled; }

    UFUNCTION(BlueprintPure, Category = "Spectator")
    AAgentCharacter* GetObservedAgent() const { return ObservedAgent; }

    UFUNCTION(BlueprintPure, Category = "Spectator")
    FText GetObservedAgentLabel() const;

    UFUNCTION(BlueprintPure, Category = "Spectator")
    float GetObservedAbilityCooldown() const;

    UFUNCTION(BlueprintPure, Category = "Spectator")
    int32 GetObservedCrystalCount() const;

protected:
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Spectator")
    float FollowDistance = 900.f;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Spectator")
    float FollowHeight = 650.f;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Spectator")
    float FollowInterpSpeed = 4.f;

private:
    void UpdateFollowCamera(float DeltaSeconds);

    UPROPERTY(Transient)
    TObjectPtr<AAgentCharacter> ObservedAgent;

    bool bFreeCameraEnabled = false;
};
