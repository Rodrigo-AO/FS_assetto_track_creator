import { useCallback } from 'react';
import type { LatLng } from '../../../domain/geo/projection';
import { addZone } from '../../../domain/project/actions';
import { SURFACES } from '../../../domain/surfaces/surfaceTypes';
import { useEditorStore } from '../../../state/editorStore';
import { useProjectStore } from '../../../state/projectStore';
import { SurfaceZonesLayer } from '../layers/SurfaceZonesLayer';
import { usePolygonDraft } from './usePolygonDraft';

export function SurfaceTool() {
  const commit = useProjectStore((s) => s.commit);
  const brush = useEditorStore((s) => s.surfaceBrush);
  const setEditor = useEditorStore((s) => s.set);
  const onFinish = useCallback(
    (points: LatLng[]) => {
      commit((p) => addZone(p, points, brush));
      setEditor({ selectedZoneId: null });
    },
    [commit, brush, setEditor],
  );
  const { points, preview } = usePolygonDraft(onFinish, SURFACES[brush].mapColor);
  return (
    <>
      {/* Mientras se dibuja, las zonas no capturan los clics para poder poner vértices encima. */}
      <SurfaceZonesLayer selectable={points.length === 0} />
      {preview}
    </>
  );
}
