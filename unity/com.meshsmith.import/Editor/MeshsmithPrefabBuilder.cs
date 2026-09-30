using System.IO;
using UnityEditor;
using UnityEngine;

namespace Meshsmith.Editor
{
    /// <summary>
    /// GLB (glTFast) imports cannot be post-processed like FBX, so this menu builds a prefab
    /// next to the selected model with the LODGroup and collider set up.
    /// </summary>
    internal static class MeshsmithPrefabBuilder
    {
        const string Menu = "Assets/Meshsmith/Create Prefab (LODs + Collider)";

        [MenuItem(Menu, true)]
        static bool Validate() => Selection.activeObject is GameObject go && PrefabUtility.IsPartOfModelPrefab(go);

        [MenuItem(Menu)]
        static void Build()
        {
            foreach (var obj in Selection.gameObjects)
            {
                var path = AssetDatabase.GetAssetPath(obj);
                if (string.IsNullOrEmpty(path)) continue;
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(obj);
                PrefabUtility.UnpackPrefabInstance(instance, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
                if (!MeshsmithSetup.Apply(instance))
                {
                    Debug.LogWarning($"Meshsmith: {obj.name} has no _LOD/_col nodes");
                    Object.DestroyImmediate(instance);
                    continue;
                }
                var target = Path.Combine(Path.GetDirectoryName(path) ?? "Assets", $"{obj.name}.prefab").Replace('\\', '/');
                PrefabUtility.SaveAsPrefabAsset(instance, target);
                Object.DestroyImmediate(instance);
                Debug.Log($"Meshsmith: prefab saved to {target}");
            }
        }
    }
}
