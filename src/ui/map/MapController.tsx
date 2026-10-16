import { useEffect } from 'react';
import { latLngBounds } from 'leaflet';
import { useMap } from 'react-leaflet';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { toL } from './leafletUtils';
import { useScene } from '../editor/sceneContext';
import { presetById } from '../../domain/presets/presets';

const FIT_PADDING = 80;

/**
 * Ajusta el comportamiento del mapa a la herramienta activa: en los modos que dibujan
 * arrastrando (Bézier y mano alzada) el arrastre no mueve el mapa salvo con Espacio pulsado,
 * como la herramienta mano de los editores de fotos.
 */
export function MapController() {
  const map = useMap();
  const scene = useScene();
  const { tool, trackMode, spacePan } = useEditorStore();
  const dragDraws = tool === 'track' && trackMode !== 'points';

  useEffect(() => {
    if (dragDraws && !spacePan) map.dragging.disable();
    else map.dragging.enable();
  }, [map, dragDraws, spacePan]);

  const fitRequest = useEditorStore((s) => s.fitRequest);
  const area = useProjectStore((s) => s.project.area);
  const presetId = useProjectStore((s) => s.project.preset);
  useEffect(() => {
    const target = area && area.length >= 3 ? area : presetById(presetId)?.polygon;
    if (fitRequest === 0 || !target || target.length < 3) return;
    const bounds = latLngBounds(target.map(toL));
    const size = map.getSize();
    // Con el mapa más pequeño que el margen (p. ej. pestaña oculta) Leaflet calcula un zoom NaN y lanza.
    if (size.x > 2 * FIT_PADDING && size.y > 2 * FIT_PADDING) {
      map.flyToBounds(bounds, { padding: [FIT_PADDING, FIT_PADDING], duration: 1.2 });
    } else {
      map.setView(bounds.getCenter(), map.getZoom(), { animate: false });
    }
    // Solo al pedirlo explícitamente (fitRequest), no en cada edición del área.
  }, [map, fitRequest]);

  useEffect(() => {
    const el = map.getContainer();
    const drawing = tool !== null && !(tool === 'area' && scene);
    el.classList.toggle('map-drawing', drawing && !spacePan);
    el.classList.toggle('map-panning', spacePan);
  }, [map, tool, scene, spacePan]);

  return null;
}
