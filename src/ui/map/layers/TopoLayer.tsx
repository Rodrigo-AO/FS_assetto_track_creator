import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ImageOverlay } from 'react-leaflet';
import { presetById } from '../../../domain/presets/presets';
import { heightAt, type TerrainGrid } from '../../../domain/presets/terrain';
import { rasterizeRelief, reliefAt } from '../../../domain/relief/relief';
import { TOPO_STOPS, topoPixels, topoRaster, type TopoRaster } from '../../../domain/relief/topo';
import { useProjectStore } from '../../../state/projectStore';
import { fetchCircuitTerrain, fetchSceneTerrain } from '../../editor/presetService';
import { useScene } from '../../editor/sceneContext';

/** Suelo del entorno del preset bajo el área (null en mapa libre o mientras se carga). */
function useBaseTerrain(): TerrainGrid | null {
  const scene = useScene();
  const presetId = useProjectStore((s) => s.project.preset);
  const area = useProjectStore((s) => s.project.area);
  const [grid, setGrid] = useState<{ key: string; grid: TerrainGrid } | null>(null);
  const preset = presetById(presetId);
  const key = preset ? `${preset.id}:${preset.kind === 'circuit' ? JSON.stringify(area) : ''}` : '';
  useEffect(() => {
    if (!preset || !scene) return;
    let alive = true;
    const load = preset.kind === 'scene' ? fetchSceneTerrain(preset.id) : fetchCircuitTerrain(preset, scene, 0.5);
    load.then((g) => alive && setGrid({ key, grid: g })).catch(() => undefined);
    return () => {
      alive = false;
    };
    // Solo al cambiar de preset o de área (no en cada edición del trazado).
  }, [key]);
  return grid?.key === key ? grid.grid : null;
}

/** Imagen PNG (data URL) de la vista. */
function rasterImage(raster: TopoRaster): string {
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(topoPixels(raster), raster.width, raster.height), 0, 0);
  return canvas.toDataURL('image/png');
}

/** Etiqueta de altura para la barra (cm por debajo del metro). */
const label = (m: number): string => (Math.abs(m) < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(2)} m`);

/**
 * Vista topográfica a color del área: altura del suelo (entorno del preset + desniveles) con una
 * barra de escala a la derecha. Sustituye al satélite mientras está activa.
 */
export function TopoLayer() {
  const scene = useScene();
  const area = useProjectStore((s) => s.project.area);
  const presetId = useProjectStore((s) => s.project.preset);
  const base = useBaseTerrain();
  const legend = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (legend.current) L.DomEvent.disableClickPropagation(legend.current).disableScrollPropagation(legend.current);
  });

  const raster = useMemo(() => {
    if (!scene || !area || area.length < 3) return null;
    const relief = rasterizeRelief(scene.relief);
    // Como al exportar: sobre un preset el desnivel solo sube.
    const onPreset = presetId !== null;
    const h = (p: { x: number; y: number }): number => {
      const r = reliefAt(relief, p);
      return (base ? (heightAt(base, p) ?? 0) : 0) + (onPreset ? Math.max(0, r) : r);
    };
    return topoRaster(area, scene.projection, scene.area, h);
  }, [scene, area, base, presetId]);
  const url = useMemo(() => (raster ? rasterImage(raster) : null), [raster]);
  if (!raster || !url) return null;

  const gradient = `linear-gradient(to top, ${TOPO_STOPS.map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${t * 100}%`).join(', ')})`;
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((t) => raster.min + t * (raster.max - raster.min));
  return (
    <>
      <ImageOverlay url={url} bounds={[[raster.south, raster.west], [raster.north, raster.east]]} pane="circuit" interactive={false} className="topo-image" />
      <div className="topo-legend" ref={legend} role="img" aria-label={`Altura del suelo de ${label(raster.min)} a ${label(raster.max)}`}>
        <span className="topo-legend-title">Altura</span>
        <div className="topo-legend-body">
          <div className="topo-legend-bar" style={{ background: gradient }} />
          <ol className="topo-legend-ticks">
            {ticks.map((m, i) => (
              <li key={i}>{label(m)}</li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}
