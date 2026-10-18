import { Circle, Polyline } from 'react-leaflet';
import { useProjectStore } from '../../../state/projectStore';
import { toL } from '../leafletUtils';
import { RELIEF_COLORS } from '../tools/BrushTool';
import { useMetersPerPixel } from '../useMetersPerPixel';

/** Opacidad de cada pasada sobre el satélite (la altura real se ve en la vista topográfica). */
const STROKE_OPACITY = 0.25;

/** Pasadas del Desnivelador sobre el satélite: naranja las que suben, azul las que bajan. */
export function ReliefStrokesLayer() {
  const relief = useProjectStore((s) => s.project.relief);
  const metersPerPixel = useMetersPerPixel();
  return (
    <>
      {relief.map((r) => {
        const color = RELIEF_COLORS[r.direction];
        if (r.points.length === 1) {
          return <Circle key={r.id} pane="zones" center={toL(r.points[0])} radius={r.radius} interactive={false} pathOptions={{ stroke: false, fillColor: color, fillOpacity: STROKE_OPACITY }} />;
        }
        return (
          <Polyline
            key={r.id}
            pane="zones"
            positions={r.points.map(toL)}
            interactive={false}
            pathOptions={{ color, opacity: STROKE_OPACITY, weight: Math.max(2, (2 * r.radius) / metersPerPixel), lineCap: 'round', lineJoin: 'round' }}
          />
        );
      })}
    </>
  );
}
