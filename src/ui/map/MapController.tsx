import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { useEditorStore } from '../../state/editorStore';
import { useScene } from '../editor/sceneContext';

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

  useEffect(() => {
    const el = map.getContainer();
    const drawing = tool !== null && !(tool === 'area' && scene);
    el.classList.toggle('map-drawing', drawing && !spacePan);
    el.classList.toggle('map-panning', spacePan);
  }, [map, tool, scene, spacePan]);

  return null;
}
