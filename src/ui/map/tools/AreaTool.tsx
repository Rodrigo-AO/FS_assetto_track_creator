import { useCallback, useState } from 'react';
import { Marker, Polygon, useMapEvents } from 'react-leaflet';
import type { LatLng } from '../../../domain/geo/projection';
import { moveAreaVertex, removeAreaVertex, setArea } from '../../../domain/project/actions';
import { useEditorStore } from '../../../state/editorStore';
import { useProjectStore } from '../../../state/projectStore';
import { fromL, ICONS, stopContextMenu, toL } from '../leafletUtils';
import { usePolygonDraft } from './usePolygonDraft';

const rectangle = (a: LatLng, b: LatLng): LatLng[] => [a, { lat: a.lat, lng: b.lng }, b, { lat: b.lat, lng: a.lng }];

function useCreateArea(): (points: LatLng[]) => void {
  const commit = useProjectStore((s) => s.commit);
  const { set, notify } = useEditorStore();
  return useCallback(
    (points: LatLng[]) => {
      commit((p) => setArea(p, points));
      set({ tool: 'track' });
      notify('Área delimitada: ya puedes trazar la pista con el Track creator.', 'success');
    },
    [commit, set, notify],
  );
}

function PolygonAreaDraft() {
  const { preview } = usePolygonDraft(useCreateArea());
  return preview;
}

function RectangleAreaDraft() {
  const create = useCreateArea();
  const [corner, setCorner] = useState<LatLng | null>(null);
  const [cursor, setCursor] = useState<LatLng | null>(null);
  useMapEvents({
    click: (e) => {
      const p = fromL(e.latlng);
      if (!corner) setCorner(p);
      else {
        create(rectangle(corner, p));
        setCorner(null);
      }
    },
    mousemove: (e) => setCursor(fromL(e.latlng)),
  });
  return corner && cursor ? (
    <Polygon pane="drafts" positions={rectangle(corner, cursor).map(toL)} interactive={false} pathOptions={{ color: '#4BB8E8', weight: 2, fillOpacity: 0.15 }} />
  ) : null;
}

/** Vértices del área existente: arrastrar para moverlos, clic derecho para quitarlos. */
function AreaVertices({ area }: { area: readonly LatLng[] }) {
  const { checkpoint, preview, commit } = useProjectStore();
  return (
    <>
      {area.map((v, i) => (
        <Marker
          key={i}
          position={toL(v)}
          icon={ICONS.vertex}
          draggable
          eventHandlers={{
            dragstart: checkpoint,
            drag: (e) => preview((p) => moveAreaVertex(p, i, fromL(e.target.getLatLng()))),
            contextmenu: (e) => {
              stopContextMenu(e);
              commit((p) => removeAreaVertex(p, i));
            },
          }}
        />
      ))}
    </>
  );
}

export function AreaTool() {
  const area = useProjectStore((s) => s.project.area);
  const mode = useEditorStore((s) => s.areaMode);
  if (area) return <AreaVertices area={area} />;
  return mode === 'rectangle' ? <RectangleAreaDraft /> : <PolygonAreaDraft />;
}
