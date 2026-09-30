using System.Linq;
using System.Text.RegularExpressions;
using UnityEngine;

namespace Meshsmith.Editor
{
    /// <summary>
    /// Turns a Meshsmith hierarchy (SM_Nome_LOD0..n, SM_Nome_col) into a LODGroup plus a
    /// convex MeshCollider. Shared by the FBX postprocessor and the GLB prefab builder.
    /// </summary>
    internal static class MeshsmithSetup
    {
        static readonly Regex Lod = new Regex(@"_LOD(\d)$");
        static readonly Regex Col = new Regex(@"(_col|-col|-colonly)$");

        // Screen-relative heights where each LOD hands over to the next (last one culls).
        static readonly float[] Transitions = { 0.5f, 0.2f, 0.05f, 0.02f };

        /// <returns>true when the hierarchy looked like a Meshsmith asset.</returns>
        public static bool Apply(GameObject root)
        {
            var nodes = root.GetComponentsInChildren<Transform>(true);
            var lods = nodes
                .Select(t => (t, m: Lod.Match(t.name)))
                .Where(x => x.m.Success)
                .OrderBy(x => int.Parse(x.m.Groups[1].Value))
                .Select(x => x.t)
                .ToList();
            var colliders = nodes.Where(t => Col.IsMatch(t.name)).ToList();
            if (lods.Count == 0 && colliders.Count == 0) return false;

            if (lods.Count > 1)
            {
                // (no ?? on UnityEngine.Object: GetComponent returns a fake null in the editor)
                if (!root.TryGetComponent(out LODGroup group)) group = root.AddComponent<LODGroup>();
                var levels = lods.Select((t, i) => new LOD(
                    Transitions[Mathf.Min(i, Transitions.Length - 1)],
                    t.GetComponentsInChildren<Renderer>(true))).ToArray();
                group.SetLODs(levels);
                group.RecalculateBounds();
            }

            foreach (var t in colliders)
            {
                foreach (var filter in t.GetComponentsInChildren<MeshFilter>(true))
                {
                    if (!filter.TryGetComponent(out MeshCollider mc)) mc = filter.gameObject.AddComponent<MeshCollider>();
                    mc.sharedMesh = filter.sharedMesh;
                    mc.convex = true;
                    // Collision only: never rendered.
                    var r = filter.GetComponent<Renderer>();
                    if (r) Object.DestroyImmediate(r);
                    Object.DestroyImmediate(filter);
                }
            }
            return true;
        }
    }
}
