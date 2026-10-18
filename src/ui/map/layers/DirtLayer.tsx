import { Circle, Polyline } from 'react-leaflet';
import { DIRT_SPECS } from '../../../domain/dirt/dirt';
import { useProjectStore } from '../../../state/projectStore';
import { toL } from '../leafletUtils';
import { useMetersPerPixel } from '../useMetersPerPixel';

/** Opacidad de cada pasada: al repasar, las capas se suman y la zona se ve más cargada. */
const STROKE_OPACITY = 0.45;

/**
 * Suciedad del Brush en el mapa: cada pasada es una línea del ancho real del pincel con extremos
 * redondeados; las pasadas superpuestas se acumulan como en el juego.
 */
export function DirtLayer() {
  const dirt = useProjectStore((s) => s.project.dirt);
  const metersPerPixel = useMetersPerPixel();
  return (
    <>
      {dirt.map((d) => {
        const color = DIRT_SPECS[d.material].mapColor;
        if (d.points.length === 1) {
          return <Circle key={d.id} pane="zones" center={toL(d.points[0])} radius={d.radius} interactive={false} pathOptions={{ stroke: false, fillColor: color, fillOpacity: STROKE_OPACITY }} />;
        }
        return (
          <Polyline
            key={d.id}
            pane="zones"
            positions={d.points.map(toL)}
            interactive={false}
            pathOptions={{ color, opacity: STROKE_OPACITY, weight: Math.max(2, (2 * d.radius) / metersPerPixel), lineCap: 'round', lineJoin: 'round' }}
          />
        );
      })}
    </>
  );
}
