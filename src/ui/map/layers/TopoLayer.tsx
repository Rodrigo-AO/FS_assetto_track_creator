import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { circuitPresetById } from '../../../domain/presets/presets';
import { rasterizeRelief, reliefSampler } from '../../../domain/relief/relief';
import { TOPO_STOPS, TOPO_TICKS, topoGrid, topoHeights, topoPixels, topoT } from '../../../domain/relief/topo';
import { useProjectStore } from '../../../state/projectStore';
import { useScene } from '../../editor/sceneContext';
import { RasterOverlay, type Raster } from '../RasterOverlay';
import { cachedFieldOf } from '../strokeFields';

/** Etiqueta de altura para la barra (cm por debajo del metro). */
const label = (m: number): string => {
  const text = Math.abs(m) < 1 ? `${Math.round(Math.abs(m) * 100)} cm` : `${Math.abs(m).toLocaleString('es-ES')} m`;
  return m < 0 ? `−${text}` : m === 0 ? '0' : text;
};

/**
 * Vista topográfica a color del área: desnivel respecto al suelo original (verde), con la escala
 * fija de −1 m (azul) a 5 m (rojo) en una barra a la derecha. Sustituye al satélite mientras está
 * activa y se actualiza mientras se pinta con el Desnivelador.
 */
export function TopoLayer() {
  const scene = useScene();
  const project = useProjectStore((s) => s.project);
  const legend = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (legend.current) L.DomEvent.disableClickPropagation(legend.current).disableScrollPropagation(legend.current);
  });

  // La rejilla solo depende del área (y del plano local, que fija el preset).
  const grid = useMemo(
    () => (scene && project.area && project.area.length >= 3 ? topoGrid(project.area, scene.projection, scene.area) : null),
    [project.area, project.preset, scene !== null],
  );
  const raster = useMemo((): Raster | null => {
    if (!scene || !grid) return null;
    const sample = reliefSampler(rasterizeRelief(scene.relief, cachedFieldOf(project, project.relief, scene.relief)), true);
    // Como al exportar: sobre un circuito de AC el desnivel solo sube.
    const onCircuit = circuitPresetById(project.preset) !== null;
    const heights = topoHeights(grid, onCircuit ? (p) => Math.max(0, sample(p)) : sample);
    return { ...grid, image: new ImageData(topoPixels(heights), grid.width, grid.height) };
  }, [grid, scene]);
  if (!raster) return null;

  const gradient = `linear-gradient(to top, ${TOPO_STOPS.map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${t * 100}%`).join(', ')})`;
  return (
    <>
      <RasterOverlay raster={raster} pane="circuit" className="topo-image" />
      <div className="topo-legend" ref={legend} role="img" aria-label="Desnivel respecto al suelo original, de −1 m a 5 m">
        <span className="topo-legend-title">Desnivel</span>
        <div className="topo-legend-body">
          <div className="topo-legend-bar" style={{ background: gradient }} />
          <ol className="topo-legend-ticks">
            {TOPO_TICKS.map((m) => (
              <li key={m} style={{ bottom: `${topoT(m) * 100}%` }}>
                {label(m)}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}
