import { Polyline } from 'react-leaflet';
import { useProjectStore } from '../../../state/projectStore';
import { toL } from '../leafletUtils';

/** Líneas pintadas en el suelo (círculos del skidpad, bordes de sus puertas). */
export function MarkingsLayer() {
  const markings = useProjectStore((s) => s.project.markings);
  return (
    <>
      {markings.map((m) => (
        <Polyline key={m.id} pane="track" positions={m.points.map(toL)} interactive={false} pathOptions={{ color: '#FFFFFF', weight: 2, opacity: 0.9 }} />
      ))}
    </>
  );
}
