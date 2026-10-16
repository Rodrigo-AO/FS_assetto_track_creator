import { CircleMarker, Marker } from 'react-leaflet';
import { CONE_SPECS } from '../../../domain/cones/coneSpecs';
import { moveCone, removeCone } from '../../../domain/project/actions';
import { useProjectStore } from '../../../state/projectStore';
import { useEditorStore } from '../../../state/editorStore';
import { isInsideArea, useScene } from '../../editor/sceneContext';
import { coneIcon, fromL, localToL, stopContextMenu, toL } from '../leafletUtils';
import { useMetersPerPixel } from '../useMetersPerPixel';
import { PAVED_CLASSES } from '../../../domain/presets/circuit';
import { useSurfaceSampler } from '../../editor/useCircuitSurfaces';
import type { Vec2 } from '../../../domain/geometry/vec2';

/** Borde de los conos que caen fuera del pavimento del circuito de AC. */
const OFF_CIRCUIT = { color: '#FF3B30', weight: 3 };

/** Radio en pantalla: crece con el zoom (≈ 0.3 m reales) entre 1.5 y 5 px. */
function coneRadius(color: string, metersPerPixel: number): number {
  const r = Math.min(5, Math.max(1.5, 0.3 / metersPerPixel));
  return color === 'orangeBig' ? r * 1.4 : r;
}

/** Conos automáticos (solo lectura) y manuales (editables con la herramienta de conos). */
export function ConesLayer() {
  const scene = useScene();
  const metersPerPixel = useMetersPerPixel();
  const radius = (color: string): number => coneRadius(color, metersPerPixel);
  const cones = useProjectStore((s) => s.project.cones);
  const { checkpoint, preview, commit } = useProjectStore();
  const editable = useEditorStore((s) => s.tool === 'cones');
  const notify = useEditorStore((s) => s.notify);
  const sample = useSurfaceSampler();
  const off = (p: Vec2): boolean => {
    if (!sample) return false;
    const c = sample(p);
    return c === null || !PAVED_CLASSES.has(c);
  };
  if (!scene) return null;

  return (
    <>
      {scene.autoCones.map((c, i) => (
        <CircleMarker
          key={`auto-${i}`}
          pane="cones"
          center={localToL(scene, c.position)}
          radius={radius(c.color)}
          interactive={false}
          pathOptions={{ color: '#000000', weight: 1, fillColor: CONE_SPECS[c.color].mapColor, fillOpacity: 1, ...(off(c.position) ? OFF_CIRCUIT : {}) }}
        />
      ))}
      {cones.map((c) =>
        editable ? (
          <Marker
            key={c.id}
            position={toL(c.position)}
            icon={coneIcon(CONE_SPECS[c.color].mapColor, Math.round(Math.max(radius(c.color), 3.5) * 2 + 4))}
            draggable
            eventHandlers={{
              dragstart: checkpoint,
              drag: (e) => preview((p) => moveCone(p, c.id, fromL(e.target.getLatLng()))),
              dragend: (e) => {
                if (!isInsideArea(scene, fromL(e.target.getLatLng()))) notify('El cono ha quedado fuera del área', 'error');
              },
              contextmenu: (e) => {
                stopContextMenu(e);
                commit((p) => removeCone(p, c.id));
              },
            }}
          />
        ) : (
          <CircleMarker
            key={c.id}
            pane="cones"
            center={toL(c.position)}
            radius={radius(c.color) + 1}
            interactive={false}
            pathOptions={{ color: '#FFFFFF', weight: 1.5, fillColor: CONE_SPECS[c.color].mapColor, fillOpacity: 1, ...(off(scene.projection.toLocal(c.position)) ? OFF_CIRCUIT : {}) }}
          />
        ),
      )}
    </>
  );
}
