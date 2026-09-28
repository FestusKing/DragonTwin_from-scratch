// Bau-Einstellungen des Spiel-Moduls. Wichtig für den Drachen: "EnhancedInput" (Tasten und Gamepad).
using UnrealBuildTool;

public class DragonTwinUE : ModuleRules
{
	public DragonTwinUE(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput" });
	}
}
