import { useMapEvents } from 'react-leaflet';
import { addCone } from '../../../domain/project/actions';
import { useEditorStore } from '../../../state/editorStore';
import { useProjectStore } from '../../../state/projectStore';
import { isInsideArea, useScene } from '../../editor/sceneContext';
import { fromL, startsOnMarker } from '../leafletUtils';

/** Coloca conos del color elegido con un clic dentro del área (el arrastre/borrado está en ConesLayer). */
export function ConeTool() {
  const scene = useScene();
  const commit = useProjectStore((s) => s.commit);
  const { coneColor, notify } = useEditorStore();
  useMapEvents({
    click: (e) => {
      if (startsOnMarker(e)) return; // clic sobre un cono existente
      const p = fromL(e.latlng);
      if (!isInsideArea(scene, p)) notify('Los conos solo se pueden colocar dentro del área delimitada', 'error');
      else commit((proj) => addCone(proj, p, coneColor));
    },
  });
  return null;
}
