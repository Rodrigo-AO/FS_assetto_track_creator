import { useEffect, useMemo, useState } from 'react';
import { LocalProjection } from '../../domain/geo/projection';
import type { Vec2 } from '../../domain/geometry/vec2';
import { checkAgainstCircuit, surfaceAt, type CircuitCheck, type SurfaceClass } from '../../domain/presets/circuit';
import { circuitPresetById } from '../../domain/presets/presets';
import { useProjectStore } from '../../state/projectStore';
import { fetchCircuitSurfaces, type CircuitSurfaces } from './presetService';
import { useScene } from './sceneContext';

export interface CircuitSurfacesState {
  readonly surfaces: CircuitSurfaces | null;
  /** Mensaje si no se pudo leer el circuito (no instalado, sin servidor local…). */
  readonly error: string | null;
}

/** Superficies del circuito de AC del preset actual (null si el preset no es un circuito). */
export function useCircuitSurfaces(): CircuitSurfacesState {
  const presetId = useProjectStore((s) => s.project.preset);
  const [state, setState] = useState<{ id: string; surfaces: CircuitSurfaces | null; error: string | null } | null>(null);
  useEffect(() => {
    const circuit = circuitPresetById(presetId);
    if (!circuit) return;
    let alive = true;
    fetchCircuitSurfaces(circuit)
      .then((surfaces) => alive && setState({ id: circuit.id, surfaces, error: null }))
      .catch((e: Error) => alive && setState({ id: circuit.id, surfaces: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [presetId]);
  return state && state.id === presetId ? state : { surfaces: null, error: null };
}

/** Clase de superficie del circuito en un punto del plano local del proyecto. */
export function useSurfaceSampler(): ((p: Vec2) => SurfaceClass | null) | null {
  const scene = useScene();
  const { surfaces } = useCircuitSurfaces();
  return useMemo(() => {
    if (!scene || !surfaces) return null;
    const tangent = new LocalProjection(surfaces.raster.origin);
    return (p: Vec2) => surfaceAt(surfaces.raster, scene.projection.toLatLng(p), tangent);
  }, [scene, surfaces]);
}

/** Comprobación en vivo del trazado y los conos contra las superficies del circuito. */
export function useCircuitCheck(): CircuitCheck | null {
  const scene = useScene();
  const sample = useSurfaceSampler();
  return useMemo(() => (scene && sample ? checkAgainstCircuit(scene, sample) : null), [scene, sample]);
}
