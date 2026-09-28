// NUR FÜR DEN TEST (nicht nach s&box kopieren!)
// Eine sehr kleine Nachbildung der s&box-Teile, die DragonController.cs benutzt.
// Nur die Namen und Typen – nichts davon macht wirklich etwas.
// Stand der Namen: s&box 2025/2026 (WorldPosition, Scene.Trace, DebugOverlay.ScreenText).
using System;

namespace Sandbox
{
	public struct Vector3
	{
		public float x, y, z;
		public Vector3( float x, float y, float z ) { this.x = x; this.y = y; this.z = z; }
		public static readonly Vector3 Up = new( 0, 0, 1 );
	}

	public struct Vector2
	{
		public float x, y;
		public Vector2( float x, float y ) { this.x = x; this.y = y; }
	}

	public struct Rotation
	{
		public float x, y, z, w;
		public Rotation( float x, float y, float z, float w ) { this.x = x; this.y = y; this.z = z; this.w = w; }
		public Vector3 Forward => new( 1, 0, 0 );
		public static Rotation LookAt( Vector3 forward, Vector3 up ) => new( 0, 0, 0, 1 );
	}

	public class GameObject { }

	public struct SceneTraceResult
	{
		public bool Hit;
		public Vector3 EndPosition;
		public Vector3 Normal;
	}

	public struct SceneTrace
	{
		public SceneTrace Ray( Vector3 from, Vector3 to ) => this;
		public SceneTrace IgnoreGameObjectHierarchy( GameObject go ) => this;
		public SceneTraceResult Run() => default;
	}

	public class Scene
	{
		public SceneTrace Trace => default;
		public CameraComponent Camera => null;
	}

	public class DebugOverlaySystem
	{
		public void ScreenText( Vector2 pixelPosition, string text, float size = 14 ) { }
	}

	public abstract class Component
	{
		public GameObject GameObject { get; }
		public Scene Scene { get; }
		public Vector3 WorldPosition { get; set; }
		public Rotation WorldRotation { get; set; }
		public DebugOverlaySystem DebugOverlay { get; }
		protected virtual void OnStart() { }
		protected virtual void OnUpdate() { }
	}

	public sealed class CameraComponent : Component
	{
		public float FieldOfView { get; set; }
	}

	public static class Input
	{
		public static Vector3 AnalogMove { get; set; }
		public static bool Down( string action ) => false;
	}

	public static class Time
	{
		public static float Delta => 1f / 60f;
	}

	public static class Log
	{
		public static void Info( string text ) { }
	}

	[AttributeUsage( AttributeTargets.Property )] public sealed class PropertyAttribute : Attribute { }
	[AttributeUsage( AttributeTargets.Property )] public sealed class GroupAttribute : Attribute { public GroupAttribute( string name ) { } }
	[AttributeUsage( AttributeTargets.Class )] public sealed class TitleAttribute : Attribute { public TitleAttribute( string t ) { } }
	[AttributeUsage( AttributeTargets.Class )] public sealed class CategoryAttribute : Attribute { public CategoryAttribute( string t ) { } }
	[AttributeUsage( AttributeTargets.Class )] public sealed class IconAttribute : Attribute { public IconAttribute( string t ) { } }
}
