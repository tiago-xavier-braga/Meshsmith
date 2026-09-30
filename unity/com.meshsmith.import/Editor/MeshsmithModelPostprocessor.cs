using System.IO;
using UnityEditor;
using UnityEngine;

namespace Meshsmith.Editor
{
    /// <summary>
    /// FBX from a Meshsmith package (a report.json sits next to it): keep our UV1 lightmap
    /// instead of Unity's, MikkTSpace tangents to match the baked normal map, and set up LODs
    /// and the collider on import.
    /// </summary>
    internal class MeshsmithModelPostprocessor : AssetPostprocessor
    {
        static bool IsMeshsmithPackage(string path) =>
            path.EndsWith(".fbx", System.StringComparison.OrdinalIgnoreCase)
            && File.Exists(Path.Combine(Path.GetDirectoryName(path) ?? "", "report.json"));

        void OnPreprocessModel()
        {
            if (!IsMeshsmithPackage(assetPath)) return;
            var importer = (ModelImporter)assetImporter;
            importer.generateSecondaryUV = false;          // UV1 is authored by meshsmith (xatlas)
            importer.importNormals = ModelImporterNormals.Import;
            importer.importTangents = ModelImporterTangents.CalculateMikk;
            importer.useFileUnits = true;                  // file declares metres (UnitScaleFactor 100)
        }

        void OnPostprocessModel(GameObject root)
        {
            if (!IsMeshsmithPackage(assetPath)) return;
            if (MeshsmithSetup.Apply(root)) Debug.Log($"Meshsmith: LODs/collider set up for {Path.GetFileName(assetPath)}");
        }
    }
}
