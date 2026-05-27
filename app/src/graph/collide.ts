// Per-node collision sizing for the 3D force layout.
//
// Nodes are drawn with THREE.PointsMaterial + sizeAttenuation, which scales each point's size
// with degree (hubs are big, leaves are small). The collision force, however, used one uniform
// radius for every node — treating each node as a point at its centre. So two big hubs were only
// kept ~2*floor apart while their drawn circles were far wider, and they visibly overlapped.
//
// These helpers give the collide force each node's *actual drawn radius* so nodes repel as the
// circles they are, not as points.

/**
 * The world-space radius a node is drawn at. With sizeAttenuation, a point of pixel-size `S`
 * projects to the same screen size as a world object of *diameter* `S*tan(fov/2)`; the point's
 * `S` is `nodeSize * scale` (scale = the node's degree multiplier), so its world *radius* is
 * `nodeSize * scale * tan(fov/2) / 2`.
 */
export function drawnNodeRadius(nodeSize: number, scale: number, fovDeg: number): number {
  return (nodeSize * scale * Math.tan(((fovDeg * Math.PI) / 180) / 2)) / 2;
}

/**
 * A node's collision radius: the larger of the uniform spacing floor and the node's own drawn
 * radius (times `padding`). Small (leaf) nodes keep the airy floor spacing; big (hub) nodes get
 * pushed apart by their real circle size, so hubs stop overlapping while the rest of the field is
 * unchanged. `padding` > 1 leaves a visible gap between big circles instead of having them touch.
 */
export function nodeCollideRadius(
  floor: number,
  nodeSize: number,
  scale: number,
  fovDeg: number,
  padding = 1,
): number {
  return Math.max(floor, drawnNodeRadius(nodeSize, scale, fovDeg) * padding);
}
