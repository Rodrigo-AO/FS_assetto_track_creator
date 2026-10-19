import { presetById } from '../../domain/presets/presets';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { useScene } from './sceneContext';

function useHint(): string | null {
  const scene = useScene();
  const { tool, areaMode, trackMode, brushMode } = useEditorStore();
  const hasTrack = useProjectStore((s) => s.project.track.anchors.length >= 2);
  const preset = presetById(useProjectStore((s) => s.project.preset));
  switch (tool) {
    case 'area':
      if (scene && preset?.kind === 'scene') return 'El área es la del escenario 3D del preset · cámbialo o vuelve al mapa libre desde «Presets»';
      if (scene) return 'Arrastra los vértices para ajustar el área · clic derecho en un vértice para quitarlo';
      return (
        (preset?.kind === 'circuit' ? `Delimita el área sobre ${preset.name} (contorno amarillo) · ` : '') +
        (areaMode === 'rectangle'
          ? 'Haz clic en dos esquinas opuestas para delimitar el área'
          : 'Haz clic para añadir vértices · clic en el primero, doble clic o Enter para cerrar · Esc cancela')
      );
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
    case 'brush':
      return brushMode === 'erase'
        ? 'Arrastra sobre la suciedad para quitar las pasadas que toque el pincel · mantén Espacio para mover el mapa'
        : 'Arrastra para esparcir arena o grava: se va sumando mientras pasas, también al repasar sin soltar · mantén Espacio para mover el mapa';
    case 'relief':
      return 'Arrastra para subir o bajar el suelo: se va sumando mientras pasas, entre −1 m y 5 m · mantén Espacio para mover el mapa';
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
