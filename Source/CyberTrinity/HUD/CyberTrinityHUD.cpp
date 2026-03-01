// Copyright 2024 Cyber Trinity. All Rights Reserved.
#include "HUD/CyberTrinityHUD.h"
#include "GameFramework/CyberTrinityGameState.h"
#include "Blueprint/UserWidget.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"

ACyberTrinityHUD::ACyberTrinityHUD()
{
}

void ACyberTrinityHUD::BeginPlay()
{
    Super::BeginPlay();

    if (HUDWidgetClass)
    {
        HUDWidget = CreateWidget<UUserWidget>(GetOwningPlayerController(), HUDWidgetClass);
        if (HUDWidget)
        {
            HUDWidget->AddToViewport(0);
        }
    }

    // Bind to game state score delegate so the HUD updates automatically
    BindToGameState();
}

void ACyberTrinityHUD::DrawHUD()
{
    Super::DrawHUD();
    // Cinematic debug overlay — only visible with ShowDebug HUD console command
}

void ACyberTrinityHUD::BindToGameState()
{
    if (ACyberTrinityGameState* GS = GetWorld()->GetGameState<ACyberTrinityGameState>())
    {
        GS->OnScoreChanged.AddDynamic(this, &ACyberTrinityHUD::UpdateScoreDisplay);
        GS->OnEventFeedEntry.AddDynamic(this, &ACyberTrinityHUD::PushEventFeedEntry);
    }
    else
    {
        // Game state not ready yet — retry next tick
        FTimerHandle RetryHandle;
        GetWorldTimerManager().SetTimer(
            RetryHandle, this, &ACyberTrinityHUD::BindToGameState, 0.1f, false);
    }
}

void ACyberTrinityHUD::UpdateScoreDisplay(EFaction Faction, int32 NewScore)
{
    // Forward to the UMG widget via the typed interface
    if (HUDWidget && HUDWidget->Implements<UCyberTrinityHUDInterface>())
    {
        ICyberTrinityHUDInterface::Execute_OnScoreUpdated(HUDWidget, Faction, NewScore);
    }
}

void ACyberTrinityHUD::PushEventFeedEntry(const FText& Message)
{
    if (HUDWidget && HUDWidget->Implements<UCyberTrinityHUDInterface>())
    {
        ICyberTrinityHUDInterface::Execute_OnEventFeedEntry(HUDWidget, Message);
    }
}
