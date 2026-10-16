import { useState } from 'react';
import { Polyline, useMapEvents } from 'react-leaflet';
import type { LatLng } from '../../../domain/geo/projection';
import { addSector, setStartFinish } from '../../../domain/project/actions';
import { snapGateToTrack, type LocalGate } from '../../../domain/track/gates';
import { useEditorStore } from '../../../state/editorStore';
import { useProjectStore } from '../../../state/projectStore';
import { useScene } from '../../editor/sceneContext';
import { GateShape } from '../layers/GatesLayer';
import { fromL, toL } from '../leafletUtils';

/**
 * Coloca la salida/meta o un sector. Con pista, la línea se ajusta perpendicular a ella;
 * sin pista (o lejos de ella) se marcan los extremos izquierdo y derecho con dos clics.
 */
export function GateTool({ kind }: { kind: 'startFinish' | 'sectors' }) {
  const scene = useScene();
  const commit = useProjectStore((s) => s.commit);
  const notify = useEditorStore((s) => s.notify);
  const [firstEnd, setFirstEnd] = useState<LatLng | null>(null);
  const [cursor, setCursor] = useState<LatLng | null>(null);

  const snapped = (p: LatLng): LocalGate | null => (scene?.track && !firstEnd ? snapGateToTrack(scene.track, scene.projection.toLocal(p)) : null);

  const place = (left: LatLng, right: LatLng): void => {
    commit((proj) => (kind === 'startFinish' ? setStartFinish(proj, left, right) : addSector(proj, left, right)));
    notify(kind === 'startFinish' ? 'Salida/meta colocada' : 'Sector añadido', 'success');
  };

  useMapEvents({
    click: (e) => {
      if (!scene) return;
      const p = fromL(e.latlng);
      const gate = snapped(p);
      if (gate) place(scene.projection.toLatLng(gate.left), scene.projection.toLatLng(gate.right));
      else if (!firstEnd) setFirstEnd(p);
      else {
        place(firstEnd, p);
        setFirstEnd(null);
      }
    },
    mousemove: (e) => setCursor(fromL(e.latlng)),
  });

  if (!scene || !cursor) return null;
  if (firstEnd) {
    return <Polyline pane="drafts" positions={[toL(firstEnd), toL(cursor)]} interactive={false} pathOptions={{ color: '#4BB8E8', weight: 4, dashArray: '6 6' }} />;
  }
  const gate = snapped(cursor);
  return gate ? <GateShape scene={scene} gate={gate} label={kind === 'startFinish' ? 'Salida / Meta' : 'Nuevo sector'} kind={kind === 'startFinish' ? 'startFinish' : 'sector'} /> : null;
}
