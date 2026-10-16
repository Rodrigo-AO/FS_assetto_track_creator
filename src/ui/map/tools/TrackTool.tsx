import { useRef, useState } from 'react';
import { Marker, Polyline, useMapEvents } from 'react-leaflet';
import type { LatLng } from '../../../domain/geo/projection';
import { simplify } from '../../../domain/geometry/polyline';
import { distance, dot, sub, type Vec2 } from '../../../domain/geometry/vec2';
import * as actions from '../../../domain/project/actions';
import type { Scene } from '../../../domain/project/scene';
import type { TrackAnchor } from '../../../domain/project/types';
import { useEditorStore } from '../../../state/editorStore';
import { useProjectStore } from '../../../state/projectStore';
import { isInsideArea, useScene } from '../../editor/sceneContext';
import { fromL, ICONS, localToL, stopContextMenu, toL } from '../leafletUtils';
import { useMetersPerPixel } from '../useMetersPerPixel';

/** Tolerancia de simplificación del trazo a mano alzada (m). */
const FREEHAND_TOLERANCE_M = 1.2;
/** Distancia al primer punto por debajo de la cual el trazo cierra el circuito (m). */
const CLOSE_LOOP_M = 6;
/** Arrastre mínimo para que la pluma cree manejadores en lugar de un punto automático (m). */
const MIN_HANDLE_M = 0.5;
/** Separación mínima en pantalla entre eje y borde para mostrar los tiradores de ancho (px). */
const MIN_WIDTH_HANDLE_PX = 10;

function useOutsideGuard(): (p: LatLng) => boolean {
  const scene = useScene();
  const notify = useEditorStore((s) => s.notify);
  return (p) => {
    if (isInsideArea(scene, p)) return true;
    notify('El trazado debe quedar dentro del área delimitada', 'error');
    return false;
  };
}

// --------------------------------------------------------------------------- modos de creación

function PointsMode() {
  const commit = useProjectStore((s) => s.commit);
  const inside = useOutsideGuard();
  useMapEvents({
    click: (e) => {
      const p = fromL(e.latlng);
      if (inside(p)) commit((proj) => actions.appendAnchors(proj, [p]));
    },
  });
  return null;
}

/** Pluma: pulsar fija el nodo y arrastrar define su manejador de salida (el de entrada es simétrico). */
function BezierMode() {
  const scene = useScene()!;
  const commit = useProjectStore((s) => s.commit);
  const spacePan = useEditorStore((s) => s.spacePan);
  const inside = useOutsideGuard();
  // El ref guarda el arrastre en curso aunque los eventos lleguen antes de que React vuelva a pintar.
  const dragRef = useRef<{ anchor: LatLng; handle: LatLng } | null>(null);
  const [drag, setDrag] = useState(dragRef.current);
  const update = (next: typeof drag): void => {
    dragRef.current = next;
    setDrag(next);
  };
  useMapEvents({
    mousedown: (e) => {
      if (spacePan || e.originalEvent.button !== 0) return;
      const p = fromL(e.latlng);
      if (inside(p)) update({ anchor: p, handle: p });
    },
    mousemove: (e) => dragRef.current && update({ ...dragRef.current, handle: fromL(e.latlng) }),
    mouseup: () => {
      const current = dragRef.current;
      if (!current) return;
      const dragged = distance(scene.projection.toLocal(current.anchor), scene.projection.toLocal(current.handle)) > MIN_HANDLE_M;
      commit((proj) => (dragged ? actions.appendBezierAnchor(proj, current.anchor, current.handle) : actions.appendAnchors(proj, [current.anchor])));
      update(null);
    },
  });
  if (!drag) return null;
  const a = scene.projection.toLocal(drag.anchor);
  const h = scene.projection.toLocal(drag.handle);
  const mirrored = scene.projection.toLatLng(sub(a, sub(h, a)));
  return <Polyline pane="drafts" positions={[toL(mirrored), toL(drag.anchor), toL(drag.handle)]} interactive={false} pathOptions={{ color: '#4BB8E8', weight: 2 }} />;
}

/** Mano alzada: el trazo se simplifica (Ramer–Douglas–Peucker) y se convierte en puntos de paso suavizados. */
function FreehandMode() {
  const scene = useScene()!;
  const anchors = useProjectStore((s) => s.project.track.anchors);
  const commit = useProjectStore((s) => s.commit);
  const spacePan = useEditorStore((s) => s.spacePan);
  const notify = useEditorStore((s) => s.notify);
  const inside = useOutsideGuard();
  const stroke = useRef<Vec2[] | null>(null);
  const [path, setPath] = useState<LatLng[]>([]);

  useMapEvents({
    mousedown: (e) => {
      if (spacePan || e.originalEvent.button !== 0) return;
      const p = fromL(e.latlng);
      if (!inside(p)) return;
      stroke.current = [scene.projection.toLocal(p)];
      setPath([p]);
    },
    mousemove: (e) => {
      if (!stroke.current) return;
      const p = fromL(e.latlng);
      if (!isInsideArea(scene, p)) return;
      stroke.current.push(scene.projection.toLocal(p));
      setPath((pts) => [...pts, p]);
    },
    mouseup: () => {
      const pts = stroke.current;
      stroke.current = null;
      setPath([]);
      if (!pts || pts.length < 2) return;
      const simplified = simplify(pts, FREEHAND_TOLERANCE_M);
      const first = anchors.length ? scene.projection.toLocal(anchors[0].position) : simplified[0];
      const closes = anchors.length + simplified.length >= 4 && distance(simplified[simplified.length - 1], first) < CLOSE_LOOP_M;
      const kept = closes ? simplified.slice(0, -1) : simplified;
      commit((proj) => {
        const next = actions.appendAnchors(proj, kept.map((v) => scene.projection.toLatLng(v)));
        return closes ? actions.setTrackOptions(next, { closed: true }) : next;
      });
      if (closes) notify('Circuito cerrado', 'success');
    },
  });
  return path.length > 1 ? <Polyline pane="drafts" positions={path.map(toL)} interactive={false} pathOptions={{ color: '#4BB8E8', weight: 3 }} /> : null;
}

// --------------------------------------------------------------------------- edición

function AnchorHandles({ anchor }: { anchor: TrackAnchor }) {
  const { checkpoint, preview } = useProjectStore();
  if (!anchor.handleIn || !anchor.handleOut) return null;
  const handle = (which: 'in' | 'out', pos: LatLng) => (
    <Marker
      position={toL(pos)}
      icon={ICONS.control}
      draggable
      eventHandlers={{
        dragstart: checkpoint,
        drag: (e) => preview((p) => actions.moveHandle(p, anchor.id, which, fromL(e.target.getLatLng()))),
      }}
    />
  );
  return (
    <>
      <Polyline pane="drafts" positions={[toL(anchor.handleIn), toL(anchor.position), toL(anchor.handleOut)]} interactive={false} pathOptions={{ color: '#4BB8E8', weight: 1.5 }} />
      {handle('in', anchor.handleIn)}
      {handle('out', anchor.handleOut)}
    </>
  );
}

/** Tiradores sobre las líneas discontinuas de los bordes: ajustan el ancho en cada punto de paso. */
function WidthHandles({ scene, anchor, sampleIndex }: { scene: Scene; anchor: TrackAnchor; sampleIndex: number }) {
  const { checkpoint, preview } = useProjectStore();
  const track = scene.track!;
  const sample = track.samples[sampleIndex];
  const handle = (side: 'left' | 'right') => (
    <Marker
      position={localToL(scene, side === 'left' ? track.leftEdge[sampleIndex] : track.rightEdge[sampleIndex])}
      icon={ICONS.width}
      draggable
      title={`Ancho ${side === 'left' ? 'izquierdo' : 'derecho'}: ${(side === 'left' ? anchor.widthLeft : anchor.widthRight).toFixed(2)} m`}
      eventHandlers={{
        dragstart: checkpoint,
        drag: (e) => {
          const offset = dot(sub(scene.projection.toLocal(fromL(e.target.getLatLng())), sample.position), sample.normal);
          preview((p) => actions.setAnchorWidth(p, anchor.id, side, side === 'left' ? offset : -offset));
        },
      }}
    />
  );
  return (
    <>
      {handle('left')}
      {handle('right')}
    </>
  );
}

function TrackEditor() {
  const scene = useScene()!;
  const track = useProjectStore((s) => s.project.track);
  const { checkpoint, preview, commit } = useProjectStore();
  const notify = useEditorStore((s) => s.notify);
  const metersPerPixel = useMetersPerPixel();
  const canClose = !track.closed && track.anchors.length >= 3;
  // Los tiradores de ancho solo se muestran cuando el borde está a una distancia útil del eje en pantalla.
  const showWidthHandles = scene.track !== null && Math.min(...track.anchors.map((a) => Math.min(a.widthLeft, a.widthRight))) / metersPerPixel >= MIN_WIDTH_HANDLE_PX;

  return (
    <>
      {track.anchors.map((a) => (
        <AnchorHandles key={`h-${a.id}`} anchor={a} />
      ))}
      {showWidthHandles &&
        track.anchors.map((a, i) => <WidthHandles key={`w-${a.id}`} scene={scene} anchor={a} sampleIndex={scene.track!.anchorSamples[i]} />)}
      {track.anchors.map((a, i) => (
        <Marker
          key={a.id}
          position={toL(a.position)}
          icon={i === 0 ? ICONS.anchorFirst : a.handleIn ? ICONS.anchorBezier : ICONS.anchor}
          draggable
          title={i === 0 && canClose ? 'Clic para cerrar el circuito' : undefined}
          eventHandlers={{
            dragstart: checkpoint,
            drag: (e) => preview((p) => actions.moveAnchor(p, a.id, fromL(e.target.getLatLng()))),
            click: () => {
              if (i === 0 && canClose) {
                commit((p) => actions.setTrackOptions(p, { closed: true }));
                notify('Circuito cerrado', 'success');
              }
            },
            dblclick: () => commit((p) => actions.toggleAnchorMode(p, a.id)),
            contextmenu: (e) => {
              stopContextMenu(e);
              commit((p) => actions.removeAnchor(p, a.id));
            },
          }}
        />
      ))}
    </>
  );
}

export function TrackTool() {
  const mode = useEditorStore((s) => s.trackMode);
  return (
    <>
      {mode === 'points' && <PointsMode />}
      {mode === 'bezier' && <BezierMode />}
      {mode === 'freehand' && <FreehandMode />}
      <TrackEditor />
    </>
  );
}
