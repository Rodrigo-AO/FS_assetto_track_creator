import { useMemo, useState } from 'react';
import { CircleMarker, Polyline, useMapEvents } from 'react-leaflet';
import { CONE_SPECS } from '../../../domain/cones/coneSpecs';
import type { LatLng } from '../../../domain/geo/projection';
import { applyTrackPreset, placer, presetFits, presetOutline, trackPresetById } from '../../../domain/trackPresets/trackPresets';
import { useEditorStore } from '../../../state/editorStore';
import { useProjectStore } from '../../../state/projectStore';
import { useScene } from '../../editor/sceneContext';
import { fromL, startsOnMarker, toL } from '../leafletUtils';

/** Fantasma del Track preset elegido bajo el cursor; un clic lo coloca (rojo si no cabe en el área). */
export function TrackPresetTool() {
  const scene = useScene();
  const { trackPresetId, trackPresetRotation, trackPresetPlacing, spacePan, set, notify } = useEditorStore();
  const area = useProjectStore((s) => s.project.area);
  const commit = useProjectStore((s) => s.commit);
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const preset = trackPresetById(trackPresetId);
  const outline = useMemo(() => (preset ? presetOutline(preset.layout) : null), [preset]);
  const active = trackPresetPlacing && scene !== null && preset !== null;

  useMapEvents({
    mousemove: (e) => active && setCursor(fromL(e.latlng)),
    mouseout: () => setCursor(null),
    click: (e) => {
      if (!active || spacePan || startsOnMarker(e) || !area) return;
      const placement = { center: fromL(e.latlng), rotationDeg: trackPresetRotation };
      if (!presetFits(preset.layout, placement, area)) return notify(`«${preset.name}» no cabe ahí: muévelo o gíralo para que quede dentro del área`, 'error');
      const { track, cones } = useProjectStore.getState().project;
      if ((track.anchors.length || cones.length) && !window.confirm(`Se sustituirán el trazado, los conos y las líneas actuales por «${preset.name}» (puedes deshacerlo). ¿Continuar?`)) return;
      commit((p) => applyTrackPreset(p, preset, placement));
      set({ trackPresetPlacing: false });
      notify(`«${preset.name}» colocado`, 'success');
    },
  });

  if (!active || !cursor || !outline || !area) return null;
  const placement = { center: cursor, rotationDeg: trackPresetRotation };
  const at = placer(placement);
  const color = presetFits(preset.layout, placement, area) ? '#4BB8E8' : '#FF3B30';
  return (
    <>
      {[outline.left, outline.right].map((edge, i) => (
        <Polyline key={i} pane="drafts" positions={edge.map((p) => toL(at(p)))} interactive={false} pathOptions={{ color, weight: 1.5, dashArray: '4 4' }} />
      ))}
      {preset.layout.cones.map((c, i) => (
        <CircleMarker key={i} pane="drafts" center={toL(at(c.p))} radius={2} interactive={false} pathOptions={{ stroke: false, fillColor: CONE_SPECS[c.color].mapColor, fillOpacity: 1 }} />
      ))}
    </>
  );
}
