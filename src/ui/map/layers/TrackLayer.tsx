import { Polygon, Polyline } from 'react-leaflet';
import { useScene } from '../../editor/sceneContext';
import { useCircuitSurfaces } from '../../editor/useCircuitSurfaces';
import { useEditorStore } from '../../../state/editorStore';
import { localToL } from '../leafletUtils';

/** Cinta de la pista, bordes discontinuos y eje. */
export function TrackLayer() {
  const scene = useScene();
  const track = scene?.track;
  // Con la capa del circuito de AC visible, la cinta deja ver las superficies que tiene debajo.
  const { surfaces } = useCircuitSurfaces();
  const showCircuit = useEditorStore((s) => s.showCircuitLayer);
  const circuitVisible = surfaces !== null && showCircuit;
  if (!scene || !track) return null;
  const left = track.leftEdge.map((v) => localToL(scene, v));
  const right = track.rightEdge.map((v) => localToL(scene, v));
  const center = track.samples.map((m) => localToL(scene, m.position));
  // Cerrado: dos anillos con relleno par-impar (la cinta); abierto: un único contorno.
  const ribbon = track.closed ? [left, right] : [[...left, ...[...right].reverse()]];
  const dashed = { color: '#FFFFFF', weight: 2, dashArray: '6 6', opacity: 0.95 };
  return (
    <>
      <Polygon pane="track" positions={ribbon} interactive={false} pathOptions={{ stroke: false, fillColor: '#504F4F', fillOpacity: circuitVisible ? 0.25 : 0.6 }} />
      <Polyline pane="track" positions={track.closed ? [...center, center[0]] : center} interactive={false} pathOptions={{ color: '#4BB8E8', weight: 1.5, opacity: 0.9 }} />
      <Polyline pane="track" positions={track.closed ? [...left, left[0]] : left} interactive={false} pathOptions={dashed} />
      <Polyline pane="track" positions={track.closed ? [...right, right[0]] : right} interactive={false} pathOptions={dashed} />
    </>
  );
}
