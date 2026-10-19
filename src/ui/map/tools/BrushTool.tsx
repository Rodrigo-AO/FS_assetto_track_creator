import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { Circle, useMapEvents } from 'react-leaflet';
import { DIRT_SPECS, strokeTouches } from '../../../domain/dirt/dirt';
import type { LatLng } from '../../../domain/geo/projection';
import { distance, type Vec2 } from '../../../domain/geometry/vec2';
import * as actions from '../../../domain/project/actions';
import { useEditorStore } from '../../../state/editorStore';
import { useProjectStore } from '../../../state/projectStore';
import { isInsideArea, useScene } from '../../editor/sceneContext';
import { fromL, startsOnMarker, toL } from '../leafletUtils';

/** Separación mínima entre puntos guardados del trazo, como fracción del radio. */
const POINT_SPACING = 0.1;

/** Colores del Desnivelador en el mapa. */
export const RELIEF_COLORS = { raise: '#F28C28', lower: '#2F80ED' } as const;

interface Stroke {
  readonly local: Vec2[];
  readonly points: LatLng[];
  /** Fotograma pedido para llevar lo pintado al proyecto (0 si no hay). */
  frame: number;
  /** ¿Hay puntos que aún no están en el proyecto? */
  dirty: boolean;
}

interface StrokeToolProps {
  readonly radius: number;
  readonly color: string;
  /**
   * Se llama al empezar la pasada y cada vez que avanza (como mucho una vez por fotograma), con
   * todo su recorrido en lat/lng: el efecto se ve mientras se pinta.
   */
  readonly onPaint: (points: LatLng[], first: boolean) => void;
  /** Si se da, el arrastre borra en vez de pintar (se llama en cada posición del pincel). */
  readonly onEraseAt?: (p: LatLng) => void;
}

/**
 * Pincel genérico, como el de máscaras de Lightroom: lo pintado aparece a medida que se arrastra
 * y repasar sin soltar vuelve a sumar. Una pasada es un paso de deshacer. Con `onEraseAt`, borra
 * por donde pasa. El círculo bajo el cursor es el tamaño real del pincel.
 */
function StrokeTool({ radius, color, onPaint, onEraseAt }: StrokeToolProps) {
  const scene = useScene()!;
  const spacePan = useEditorStore((s) => s.spacePan);
  const checkpoint = useProjectStore((s) => s.checkpoint);
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const stroke = useRef<Stroke | null>(null);
  const erasing = useRef(false);
  const paint = useRef(onPaint);
  paint.current = onPaint;

  // Fin de la pasada: estable entre renders para poder quitar los escuchadores de window.
  const end = useRef((): void => {
    const s = stroke.current;
    if (!s && !erasing.current) return;
    if (s) {
      cancelAnimationFrame(s.frame);
      push(s);
    }
    stroke.current = null;
    erasing.current = false;
    L.DomUtil.enableTextSelection();
    window.removeEventListener('mouseup', end.current);
    window.removeEventListener('blur', end.current);
  });
  useEffect(() => end.current, []);

  /** Lleva al proyecto lo pintado desde la última vez. */
  function push(s: Stroke): void {
    if (!s.dirty) return;
    s.dirty = false;
    paint.current([...s.points], false);
  }

  useMapEvents({
    mousedown: (e) => {
      if (spacePan || e.originalEvent.button !== 0 || startsOnMarker(e)) return;
      const p = fromL(e.latlng);
      if (!isInsideArea(scene, p)) return;
      // Sin esto el navegador empieza a seleccionar texto o a arrastrar la imagen del mapa y el
      // pincel se queda sin el «soltar».
      e.originalEvent.preventDefault();
      L.DomUtil.disableTextSelection();
      // El botón se suelta donde sea (también fuera del mapa).
      window.addEventListener('mouseup', end.current);
      window.addEventListener('blur', end.current);
      checkpoint();
      if (onEraseAt) {
        erasing.current = true;
        onEraseAt(p);
        return;
      }
      stroke.current = { local: [scene.projection.toLocal(p)], points: [p], frame: 0, dirty: false };
      paint.current([p], true);
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
      s.dirty = true;
      // Como mucho una actualización del proyecto por fotograma.
      if (!s.frame)
        s.frame = requestAnimationFrame(() => {
          s.frame = 0;
          push(s);
        });
    },
    mouseout: () => setCursor(null),
  });

  return cursor ? (
    <Circle
      pane="drafts"
      center={toL(cursor)}
      radius={radius}
      interactive={false}
      pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: onEraseAt ? 0.1 : 0.15 }}
    />
  ) : null;
}

/** Brush: esparce arena o grava; en modo borrar, quita las pasadas que toca el pincel. */
export function BrushTool() {
  const scene = useScene()!;
  const { brushMaterial, brushSize, brushMode } = useEditorStore();
  const preview = useProjectStore((s) => s.preview);
  const id = useRef('');
  const radius = brushSize / 2;
  const eraseAt = (p: LatLng): void => {
    const local = scene.projection.toLocal(p);
    preview((proj) => {
      const hit = proj.dirt.filter((d) => strokeTouches({ radius: d.radius, points: d.points.map((q) => scene.projection.toLocal(q)) }, local, radius));
      return actions.removeDirtStrokes(proj, new Set(hit.map((d) => d.id)));
    });
  };
  const paint = (points: LatLng[], first: boolean): void => {
    if (first) id.current = actions.newId();
    preview((proj) => (first ? actions.addDirtStroke(proj, brushMaterial, radius, points, id.current) : actions.setDirtStrokePoints(proj, id.current, points)));
  };
  return (
    <StrokeTool
      radius={radius}
      color={brushMode === 'erase' ? '#FF3B30' : DIRT_SPECS[brushMaterial].mapColor}
      onPaint={paint}
      onEraseAt={brushMode === 'erase' ? eraseAt : undefined}
    />
  );
}

/** Desnivelador: sube o baja el suelo por donde se arrastra, sumando mientras se pinta. */
export function ReliefTool() {
  const { reliefDirection, reliefRadius } = useEditorStore();
  const preview = useProjectStore((s) => s.preview);
  const id = useRef('');
  const paint = (points: LatLng[], first: boolean): void => {
    if (first) id.current = actions.newId();
    preview((proj) =>
      first ? actions.addReliefStroke(proj, reliefDirection, reliefRadius, points, id.current) : actions.setReliefStrokePoints(proj, id.current, points),
    );
  };
  return <StrokeTool radius={reliefRadius} color={RELIEF_COLORS[reliefDirection]} onPaint={paint} />;
}
