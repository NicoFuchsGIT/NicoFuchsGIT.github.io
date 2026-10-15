import * as THREE from 'three';
import { createSpikeballTitanRoundnetModel } from './_factory';

export { createSpikeballTitanRoundnetModel as createSpikeballModel };

type Runtime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

export const runtimeOf = (model: THREE.Object3D): Runtime => model.userData.sculptRuntime as Runtime;

/** Component id for any object hit by a raycast (walks up to the named component pivot), or null. */
export function partIdFromObject(model: THREE.Object3D, object: THREE.Object3D | null): string | null {
  const { nodes } = runtimeOf(model);
  const byNode = new Map<THREE.Object3D, string>(Object.entries(nodes).map(([id, node]) => [node, id]));
  for (let o: THREE.Object3D | null = object; o && o !== model; o = o.parent) {
    const id = byNode.get(o);
    if (id) return id;
  }
  return null;
}

/** Every pickable mesh (component meshes + instanced cord/screw groups). */
export function pickableMeshes(model: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o); });
  return out;
}

const BASE = Symbol('explodeBase');

/**
 * Explode by SCALING each part's layout about the model centre (amount 0 = assembled, 1 = fully
 * opened) so gaps open between parts instead of the whole arrangement translating.
 */
export function setExplode(model: THREE.Object3D, amount: number, spread = 1.0): void {
  const { nodes } = runtimeOf(model);
  const ids = Object.keys(nodes).filter((id) => nodes[id] !== model);
  model.updateMatrixWorld(true);
  for (const id of ids) {
    const n = nodes[id] as any;
    if (!n[BASE]) n[BASE] = n.position.clone();
    n.position.copy(n[BASE]);
  }
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3());
  const world = new Map<string, THREE.Vector3>();
  for (const id of ids) {
    const mesh = runtimeOf(model).meshes[id];
    world.set(id, new THREE.Box3().setFromObject(mesh ?? nodes[id]).getCenter(new THREE.Vector3()));
  }
  for (const id of ids) {
    const n = nodes[id] as any;
    if (!n.parent) continue;
    const d = world.get(id)!.clone().sub(centre).multiplyScalar(amount * spread);
    const target = n.getWorldPosition(new THREE.Vector3()).add(d);
    n.position.copy(n.parent.worldToLocal(target));
  }
  model.updateMatrixWorld(true);
}

/** Give ONLY this model image-based lighting (the host scene's own lights/floor stay untouched). */
export function applyEnvironment(model: THREE.Object3D, envTexture: THREE.Texture, intensity = 0.6): void {
  model.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      const std = mat as THREE.MeshStandardMaterial;
      std.envMap = envTexture;
      std.envMapIntensity = intensity;
      std.needsUpdate = true;
    }
  });
}
