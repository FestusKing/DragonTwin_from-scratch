// NUR FÜR DEN TEST (nicht nach s&box kopieren!)
// Eine sehr kleine Nachbildung der s&box-Teile, die DragonController.cs benutzt.
// Nur die Namen und Typen – nichts davon macht wirklich etwas.
// Stand der Namen: s&box 2025/2026 (WorldPosition, Scene.Trace, DebugOverlay.ScreenText,
// Scene.CreateObject, Components.Create, FileSystem.Data.ReadJson/WriteJson, Model.Bounds).
using System;

namespace Sandbox
{
	public struct Vector3
	{
		public float x, y, z;
		public Vector3( float x, float y, float z ) { this.x = x; this.y = y; this.z = z; }
		public static readonly Vector3 Up = new( 0, 0, 1 );
		public static Vector3 operator +( Vector3 a, Vector3 b ) => new( a.x + b.x, a.y + b.y, a.z + b.z );
	}

	public struct Color
	{
		public float r, g, b, a;
		public Color( float r, float g, float b, float a = 1f ) { this.r = r; this.g = g; this.b = b; this.a = a; }
		public static readonly Color White = new( 1, 1, 1 );
	}

	public struct BBox
	{
		public Vector3 Size;
	}

	public class Model
	{
		public BBox Bounds => default;
		public static Model Load( string path ) => new();
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
		public static Rotation operator *( Rotation a, Rotation b ) => a;
		public static Vector3 operator *( Rotation a, Vector3 b ) => b;
	}

	public sealed class ComponentList
	{
		public T Create<T>() where T : Component, new() => new();
	}

	public class GameObject
	{
		public string Name { get; set; }
		public bool Enabled { get; set; }
		public Vector3 WorldPosition { get; set; }
		public Rotation WorldRotation { get; set; }
		public Vector3 WorldScale { get; set; }
		public Vector3 LocalPosition { get; set; }
		public Rotation LocalRotation { get; set; }
		public Vector3 LocalScale { get; set; }
		public ComponentList Components { get; } = new();
		public T GetComponent<T>() where T : Component => null;
		public void Destroy() { }
	}

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
		public GameObject CreateObject( bool enabled = true ) => new();
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
		protected virtual void OnDestroy() { }
	}

	public class ModelRenderer : Component
	{
		public Model Model { get; set; }
		public Color Tint { get; set; }
	}

	public class SkinnedModelRenderer : ModelRenderer { }

	public class BaseFileSystem
	{
		public bool FileExists( string path ) => false;
		public T ReadJson<T>( string path, T defaultValue = default ) => defaultValue;
		public void WriteJson<T>( string path, T value ) { }
	}

	public static class FileSystem
	{
		public static BaseFileSystem Data { get; } = new();
	}

	public sealed class CameraComponent : Component
	{
		public float FieldOfView { get; set; }
	}

	public static class Input
	{
		public static Vector3 AnalogMove { get; set; }
		public static bool Down( string action ) => false;
		public static bool Pressed( string action ) => false;
	}

	public static class Time
	{
		public static float Delta => 1f / 60f;
	}

	public static class Log
	{
		public static void Info( string text ) { }
		public static void Warning( string text ) { }
	}

	[AttributeUsage( AttributeTargets.Property )] public sealed class PropertyAttribute : Attribute { }
	[AttributeUsage( AttributeTargets.Property )] public sealed class GroupAttribute : Attribute { public GroupAttribute( string name ) { } }
	[AttributeUsage( AttributeTargets.Class )] public sealed class TitleAttribute : Attribute { public TitleAttribute( string t ) { } }
	[AttributeUsage( AttributeTargets.Class )] public sealed class CategoryAttribute : Attribute { public CategoryAttribute( string t ) { } }
	[AttributeUsage( AttributeTargets.Class )] public sealed class IconAttribute : Attribute { public IconAttribute( string t ) { } }
}
