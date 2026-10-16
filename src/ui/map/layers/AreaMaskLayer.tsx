import { Polygon } from 'react-leaflet';
import { circuitPresetById } from '../../../domain/presets/presets';
import { useProjectStore } from '../../../state/projectStore';
import { toL, type LPoint } from '../leafletUtils';

/** Anillo que cubre el mundo: con el área como agujero, oscurece todo lo que queda fuera. */
const WORLD: LPoint[] = [
  [-85, -180],
  [-85, 180],
  [85, 180],
  [85, -180],
];

export function AreaMaskLayer() {
  const area = useProjectStore((s) => s.project.area);
  const circuit = circuitPresetById(useProjectStore((s) => s.project.preset));
  if (!area || area.length < 3) {
    // Sobre un circuito de AC, mientras no hay área se marca el contorno del circuito.
    return circuit ? (
      <Polygon pane="mask" positions={circuit.polygon.map(toL)} interactive={false} pathOptions={{ color: '#F5C542', weight: 2, dashArray: '6 6', fill: false }} />
    ) : null;
  }
  const ring = area.map(toL);
  return (
    <>
      <Polygon pane="mask" positions={[WORLD, ring]} interactive={false} pathOptions={{ stroke: false, fillColor: '#000000', fillOpacity: 0.55 }} />
      <Polygon pane="mask" positions={ring} interactive={false} pathOptions={{ color: '#4BB8E8', weight: 2, fill: false }} />
    </>
  );
}
