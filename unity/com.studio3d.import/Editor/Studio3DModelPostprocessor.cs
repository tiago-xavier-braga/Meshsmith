using System.IO;
using UnityEditor;
using UnityEngine;

namespace Studio3D.Editor
{
    /// <summary>
    /// FBX from a 3D Studio package (a report.json sits next to it): keep our UV1 lightmap
    /// instead of Unity's, MikkTSpace tangents to match the baked normal map, and set up LODs
    /// and the collider on import.
    /// </summary>
    internal class Studio3DModelPostprocessor : AssetPostprocessor
    {
        static bool IsStudioPackage(string path) =>
            path.EndsWith(".fbx", System.StringComparison.OrdinalIgnoreCase)
            && File.Exists(Path.Combine(Path.GetDirectoryName(path) ?? "", "report.json"));

        void OnPreprocessModel()
        {
            if (!IsStudioPackage(assetPath)) return;
            var importer = (ModelImporter)assetImporter;
            importer.generateSecondaryUV = false;          // UV1 is authored by studio3d (xatlas)
            importer.importNormals = ModelImporterNormals.Import;
            importer.importTangents = ModelImporterTangents.CalculateMikk;
            importer.useFileUnits = true;                  // file declares metres (UnitScaleFactor 100)
        }

        void OnPostprocessModel(GameObject root)
        {
            if (!IsStudioPackage(assetPath)) return;
            if (Studio3DSetup.Apply(root)) Debug.Log($"3D Studio: LODs/collider set up for {Path.GetFileName(assetPath)}");
        }
    }
}
