import { createContext, useContext } from 'react';
import type { LatLng } from '../../domain/geo/projection';
import { pointInRing } from '../../domain/geometry/polygon';
import type { Scene } from '../../domain/project/scene';

/** Escena derivada del proyecto, calculada una vez por cambio y compartida por todas las capas. */
export const SceneContext = createContext<Scene | null>(null);

export const useScene = (): Scene | null => useContext(SceneContext);

export function isInsideArea(scene: Scene | null, p: LatLng): boolean {
  return scene !== null && pointInRing(scene.projection.toLocal(p), scene.area);
}
