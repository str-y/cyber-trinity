// Copyright 2024 Cyber Trinity. All Rights Reserved.

using UnrealBuildTool;

public class CyberTrinity : ModuleRules
{
    public CyberTrinity(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore",
            "EnhancedInput",
            "AIModule",
            "NavigationSystem",
            "GameplayAbilities",
            "GameplayTags",
            "GameplayTasks",
            "UMG",
            "Niagara",
            "PhysicsCore",
            "RenderCore",
            "Renderer"
        });

        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "Slate",
            "SlateCore",
            "MovieScene",
            "LevelSequence"
        });
    }
}
