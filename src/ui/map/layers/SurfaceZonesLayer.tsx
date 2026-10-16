import { Polygon } from 'react-leaflet';
import { SURFACES } from '../../../domain/surfaces/surfaceTypes';
import { useEditorStore } from '../../../state/editorStore';
import { useProjectStore } from '../../../state/projectStore';
import { toL } from '../leafletUtils';

/**
 * Zonas de suelo dibujadas. Con la herramienta de suelo activa (y sin un polígono a medias)
 * se pueden seleccionar con un clic.
 */
export function SurfaceZonesLayer({ selectable = false }: { selectable?: boolean }) {
  const zones = useProjectStore((s) => s.project.zones);
  const selectedId = useEditorStore((s) => s.selectedZoneId);
  const setEditor = useEditorStore((s) => s.set);
  return (
    <>
      {zones.map((zone) => (
        <Polygon
          // `interactive` solo se aplica al crear la capa: se recrea al cambiar
          key={`${zone.id}-${selectable}`}
          pane="zones"
          positions={zone.polygon.map(toL)}
          interactive={selectable}
          bubblingMouseEvents={false}
          eventHandlers={selectable ? { click: () => setEditor({ selectedZoneId: zone.id }) } : undefined}
          pathOptions={{
            color: zone.id === selectedId ? '#4BB8E8' : '#FFFFFF',
            weight: zone.id === selectedId ? 3 : 1,
            fillColor: SURFACES[zone.type].mapColor,
            fillOpacity: 0.6,
          }}
        />
      ))}
    </>
  );
}
