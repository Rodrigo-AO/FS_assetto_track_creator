import { useRef, useState } from 'react';
import { Circle, Polyline, useMapEvents } from 'react-leaflet';
import { DIRT_SPECS, strokeTouches } from '../../../domain/dirt/dirt';
import type { LatLng } from '../../../domain/geo/projection';
import { distance, type Vec2 } from '../../../domain/geometry/vec2';
import * as actions from '../../../domain/project/actions';
import { useEditorStore } from '../../../state/editorStore';
import { useProjectStore } from '../../../state/projectStore';
import { isInsideArea, useScene } from '../../editor/sceneContext';
import { fromL, toL } from '../leafletUtils';

/** Separación mínima entre puntos del trazo, como fracción del radio. */
const POINT_SPACING = 0.25;

/** Colores del Desnivelador en el mapa. */
export const RELIEF_COLORS = { raise: '#F28C28', lower: '#2F80ED' } as const;

interface StrokeToolProps {
  readonly radius: number;
  readonly color: string;
  /** Pasada terminada (puntos en lat/lng). */
  readonly onStroke: (points: LatLng[]) => void;
  /** Si se da, el arrastre borra en vez de pintar (se llama en cada posición del pincel). */
  readonly onEraseAt?: (p: LatLng) => void;
}

/**
 * Pincel genérico: arrastrar dibuja una pasada (una por arrastre) dentro del área; con
 * `onEraseAt`, borra por donde pasa. El círculo bajo el cursor es el tamaño real del pincel.
 */
function StrokeTool({ radius, color, onStroke, onEraseAt }: StrokeToolProps) {
  const scene = useScene()!;
  const spacePan = useEditorStore((s) => s.spacePan);
  const checkpoint = useProjectStore((s) => s.checkpoint);
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const [path, setPath] = useState<LatLng[]>([]);
  const stroke = useRef<{ local: Vec2[]; points: LatLng[] } | null>(null);
  const erasing = useRef(false);

  useMapEvents({
    mousedown: (e) => {
      if (spacePan || e.originalEvent.button !== 0) return;
      const p = fromL(e.latlng);
      if (!isInsideArea(scene, p)) return;
      if (onEraseAt) {
        checkpoint();
        erasing.current = true;
        onEraseAt(p);
        return;
      }
      stroke.current = { local: [scene.projection.toLocal(p)], points: [p] };
      setPath([p]);
    },
    mousemove: (e) => {
      const p = fromL(e.latlng);
      setCursor(p);
      if (erasing.current) return onEraseAt?.(p);
      const s = stroke.current;
      if (!s || !isInsideArea(scene, p)) return;
      const local = scene.projection.toLocal(p);
      if (distance(local, s.local[s.local.length - 1]) < radius * POINT_SPACING) return;
      s.local.push(local);
      s.points.push(p);
      setPath([...s.points]);
    },
    mouseup: () => {
      erasing.current = false;
      const s = stroke.current;
      stroke.current = null;
      setPath([]);
      if (s) onStroke(s.points);
    },
    mouseout: () => setCursor(null),
  });

  return (
    <>
      {path.length > 1 && (
        <Polyline pane="drafts" positions={path.map(toL)} interactive={false} pathOptions={{ color, weight: 2, dashArray: '4 4' }} />
      )}
      {cursor && (
        <Circle
          pane="drafts"
          center={toL(cursor)}
          radius={radius}
          interactive={false}
          pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: onEraseAt ? 0.1 : 0.25 }}
        />
      )}
    </>
  );
}

/** Brush: esparce arena o grava; en modo borrar, quita las pasadas que toca el pincel. */
export function BrushTool() {
  const scene = useScene()!;
  const { brushMaterial, brushSize, brushMode } = useEditorStore();
  const { commit, preview } = useProjectStore();
  const radius = brushSize / 2;
  const eraseAt = (p: LatLng): void => {
    const local = scene.projection.toLocal(p);
    preview((proj) => {
      const hit = proj.dirt.filter((d) => strokeTouches({ radius: d.radius, points: d.points.map((q) => scene.projection.toLocal(q)) }, local, radius));
      return actions.removeDirtStrokes(proj, new Set(hit.map((d) => d.id)));
    });
  };
  return (
    <StrokeTool
      radius={radius}
      color={brushMode === 'erase' ? '#FF3B30' : DIRT_SPECS[brushMaterial].mapColor}
      onStroke={(points) => commit((proj) => actions.addDirtStroke(proj, brushMaterial, radius, points))}
      onEraseAt={brushMode === 'erase' ? eraseAt : undefined}
    />
  );
}

/** Desnivelador: cada pasada sube o baja el suelo por donde se arrastra. */
export function ReliefTool() {
  const { reliefDirection, reliefRadius } = useEditorStore();
  const commit = useProjectStore((s) => s.commit);
  return (
    <StrokeTool
      radius={reliefRadius}
      color={RELIEF_COLORS[reliefDirection]}
      onStroke={(points) => commit((proj) => actions.addReliefStroke(proj, reliefDirection, reliefRadius, points))}
    />
  );
}
