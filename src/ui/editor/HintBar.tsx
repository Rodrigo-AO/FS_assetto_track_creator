import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { useScene } from './sceneContext';

function useHint(): string | null {
  const scene = useScene();
  const { tool, areaMode, trackMode } = useEditorStore();
  const hasTrack = useProjectStore((s) => s.project.track.anchors.length >= 2);
  switch (tool) {
    case 'area':
      if (scene) return 'Arrastra los vértices para ajustar el área · clic derecho en un vértice para quitarlo';
      return areaMode === 'rectangle'
        ? 'Haz clic en dos esquinas opuestas para delimitar el área'
        : 'Haz clic para añadir vértices · clic en el primero, doble clic o Enter para cerrar · Esc cancela';
    case 'track':
      return {
        points: 'Clic para añadir puntos de paso · arrastra un punto para moverlo · doble clic: nodo Bézier · clic derecho: borrar',
        bezier: 'Pulsa y arrastra para crear un nodo con manejadores · mantén Espacio para mover el mapa',
        freehand: 'Pulsa y dibuja el trazado a mano alzada · mantén Espacio para mover el mapa',
      }[trackMode];
    case 'cones':
      return 'Clic dentro del área para poner un cono · arrástralo para moverlo · clic derecho para quitarlo';
    case 'startFinish':
    case 'sectors':
      return hasTrack
        ? 'Haz clic sobre la pista para colocar la línea perpendicular'
        : 'Haz clic en el extremo izquierdo y después en el derecho (según el sentido de la marcha)';
    case 'surface':
      return 'Dibuja un polígono con el suelo elegido · doble clic o Enter para cerrar · clic en una zona para editarla';
    default:
      return scene ? null : 'Empieza con «Delimitar área»: el resto de herramientas se activan al delimitarla';
  }
}

export function HintBar() {
  const hint = useHint();
  return hint ? <div className="hintbar">{hint}</div> : null;
}
