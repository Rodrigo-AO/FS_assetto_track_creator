import { useMemo } from 'react';
import { CONE_SPECS } from '../../domain/cones/coneSpecs';
import { presetById } from '../../domain/presets/presets';
import { applyTrackPresetAtHome, presetOutline, TRACK_PRESETS, trackPresetById, type TrackPreset } from '../../domain/trackPresets/trackPresets';
import type { XY } from '../../domain/trackPresets/types';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { useScene } from './sceneContext';

/** Miniatura vectorial del circuito: bordes y conos. */
function Thumbnail({ preset }: { preset: TrackPreset }) {
  const view = useMemo(() => {
    const { left, right } = presetOutline(preset.layout);
    const all = [...left, ...right, ...preset.layout.cones.map((c) => c.p)];
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const span = Math.max(x1 - x0, (y1 - y0) * 1.4) * 1.08;
    const path = (pts: readonly XY[]): string => pts.map(([x, y]) => `${x.toFixed(1)},${(-y).toFixed(1)}`).join(' ');
    return { box: `${(x0 + x1) / 2 - span / 2} ${-(y0 + y1) / 2 - span / 2.8} ${span} ${span / 1.4}`, left: path(left), right: path(right), dot: span / 110 };
  }, [preset]);
  return (
    <svg className="track-preset-thumb" viewBox={view.box} aria-hidden="true">
      {[view.left, view.right].map((points, i) => (
        <polyline key={i} points={points} fill="none" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={view.dot * 0.7} />
      ))}
      {preset.layout.cones.map((c, i) => (
        <circle key={i} cx={c.p[0]} cy={-c.p[1]} r={view.dot} fill={CONE_SPECS[c.color].mapColor} />
      ))}
    </svg>
  );
}

/** Herramienta «Track presets»: circuitos hechos, en su sitio real o donde se coloquen. */
export function TrackPresetsPanel() {
  const scene = useScene();
  const { trackPresetId, trackPresetRotation, trackPresetPlacing, fitRequest, set, notify } = useEditorStore();
  const commit = useProjectStore((s) => s.commit);
  const preset = trackPresetById(trackPresetId) ?? TRACK_PRESETS[0];
  const site = preset.home && presetById(preset.home.presetId);

  const loadAtHome = (): void => {
    const { project } = useProjectStore.getState();
    const replaces = project.track.anchors.length > 0 || project.cones.length > 0;
    const moves = project.preset !== site!.id && project.area !== null;
    if ((replaces || moves) && !window.confirm(`Se cargará «${preset.name}» en «${site!.name}»: se sustituyen el área, el trazado, los conos y las líneas actuales (puedes deshacerlo). ¿Continuar?`)) return;
    commit((p) => applyTrackPresetAtHome(p, preset));
    set({ trackPresetPlacing: false, fitRequest: fitRequest + 1 });
    notify(`«${preset.name}» cargado en «${site!.name}»`, 'success');
  };

  return (
    <div className="stack">
      <div className="track-preset-list">
        {TRACK_PRESETS.map((t) => (
          <button
            key={t.id}
            className="preset-card"
            aria-pressed={t.id === preset.id}
            onClick={() => set({ trackPresetId: t.id, trackPresetPlacing: t.home === null })}
          >
            <Thumbnail preset={t} />
            <span>
              <strong>{t.name}</strong>
              <small>
                {t.layout.cones.length} conos{t.home && ` · ${presetById(t.home.presetId)?.name}`}
              </small>
            </span>
          </button>
        ))}
      </div>
      <p className="muted panel-text">{preset.description}</p>
      {site && (
        <button className="btn btn-primary" onClick={loadAtHome}>
          Cargar en «{site.name}»
        </button>
      )}
      <button
        className={`btn btn-sm ${trackPresetPlacing ? 'btn-primary' : ''}`}
        aria-pressed={trackPresetPlacing}
        disabled={!scene}
        onClick={() => set({ trackPresetPlacing: !trackPresetPlacing })}
      >
        {trackPresetPlacing ? 'Haz clic en el mapa para colocarlo' : 'Colocar en el mapa'}
      </button>
      {!scene && <p className="muted panel-text">Para colocarlo donde quieras, delimita primero un área.</p>}
      {trackPresetPlacing && scene && (
        <label className="field">
          <span className="field-label">Giro: {trackPresetRotation}°</span>
          <input
            className="range"
            type="range"
            min={0}
            max={359}
            step={1}
            value={trackPresetRotation}
            onChange={(e) => set({ trackPresetRotation: Number(e.target.value) })}
            aria-label="Giro del circuito (grados)"
          />
        </label>
      )}
      <p className="muted panel-text">Sustituye el trazado, los conos, la salida y los sectores. Después puedes editarlo con el resto de herramientas.</p>
    </div>
  );
}
