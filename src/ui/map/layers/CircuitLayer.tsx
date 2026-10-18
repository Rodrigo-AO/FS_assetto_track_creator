import { ImageOverlay, Polyline } from 'react-leaflet';
import { useEditorStore } from '../../../state/editorStore';
import { useScene } from '../../editor/sceneContext';
import { useCircuitCheck, useCircuitSurfaces } from '../../editor/useCircuitSurfaces';
import { localToL, toL, type LPoint } from '../leafletUtils';

/** Opacidad de la capa de superficies sobre el satélite. */
const OVERLAY_OPACITY = 0.5;

/**
 * Circuito de AC bajo el editor: sus superficies físicas (asfalto, pianos, césped…) pintadas sobre
 * el satélite y, encima del trazado, en rojo los tramos que caen fuera del pavimento del circuito.
 */
export function CircuitLayer() {
  const scene = useScene();
  // En la vista topográfica no se pinta: la altura ocupa el fondo del mapa.
  const show = useEditorStore((s) => s.showCircuitLayer && s.mapView === 'satellite');
  const { surfaces } = useCircuitSurfaces();
  const check = useCircuitCheck();
  if (!surfaces) return null;

  const runs: LPoint[][] = [];
  if (scene?.track && check) {
    let run: LPoint[] = [];
    scene.track.samples.forEach((m, i) => {
      if (check.offSamples[i]) run.push(localToL(scene, m.position));
      else if (run.length) {
        runs.push(run);
        run = [];
      }
    });
    if (run.length) runs.push(run);
  }

  return (
    <>
      {show && (
        <ImageOverlay
          url={surfaces.imageUrl}
          bounds={[toL(surfaces.bounds[0]), toL(surfaces.bounds[1])]}
          opacity={OVERLAY_OPACITY}
          pane="circuit"
          className="circuit-surfaces"
          interactive={false}
        />
      )}
      {runs.map((positions, i) => (
        <Polyline key={i} pane="gates" positions={positions} interactive={false} pathOptions={{ color: '#FF3B30', weight: 5, opacity: 0.9 }} />
      ))}
    </>
  );
}
