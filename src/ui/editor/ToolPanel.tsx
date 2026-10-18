import { useEffect, useState, type ReactNode } from 'react';
import { presetAssets, presetById, type CircuitPreset } from '../../domain/presets/presets';
import { DIRT_MATERIALS, DIRT_SPECS } from '../../domain/dirt/dirt';
import { RELIEF_MIN_M, RELIEF_STEP_M } from '../../domain/relief/relief';
import { parseTerrain, terrainRange, type TerrainJson } from '../../domain/presets/terrain';
import { CONE_COLORS, CONE_SPECS } from '../../domain/cones/coneSpecs';
import * as actions from '../../domain/project/actions';
import { createEmptyProject } from '../../domain/project/types';
import { SURFACES, SURFACE_TYPES } from '../../domain/surfaces/surfaceTypes';
import { useEditorStore, type TrackMode } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { CloseIcon, TrashIcon } from '../icons';
import { useScene } from './sceneContext';
import { TOOLS } from './Toolbar';

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

function NumberInput({ value, min, max, step, onCommit }: { value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  return (
    <input
      className="input"
      type="number"
      key={value}
      defaultValue={Math.round(value * 100) / 100}
      min={min}
      max={max}
      step={step}
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v !== value) onCommit(Math.min(max, Math.max(min, v)));
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

// --------------------------------------------------------------------------- paneles

/** Desnivel del terreno del preset (se descarga terrain.json una vez). */
function usePresetRelief(id: string | null): number | null {
  const [relief, setRelief] = useState<number | null>(null);
  useEffect(() => {
    setRelief(null);
    if (!id) return;
    let alive = true;
    fetch(presetAssets(id).terrain)
      .then((r) => r.json())
      .then((json: TerrainJson) => {
        const { min, max } = terrainRange(parseTerrain(json));
        if (alive) setRelief(max - min);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);
  return relief;
}

function PresetAreaPanel({ presetId }: { presetId: string }) {
  const preset = presetById(presetId)!;
  const commit = useProjectStore((s) => s.commit);
  const relief = usePresetRelief(presetId);
  return (
    <div className="stack">
      <img className="preset-preview" src={presetAssets(presetId).preview} alt={`Escenario 3D de ${preset.name}`} />
      <p className="panel-text">
        <strong>{preset.name}</strong> · {preset.description}
      </p>
      <p className="muted panel-text">
        El área es la del escenario 3D y no se puede editar.
        {relief !== null && ` Desnivel del terreno: ${relief.toFixed(1)} m (los conos y líneas se apoyan en él al exportar).`}
      </p>
      <button className="btn btn-sm" onClick={() => commit(actions.clearPreset)}>
        Pasar a mapa libre (área editable)
      </button>
    </div>
  );
}

/** Circuito de AC sobre el que se delimita el área: qué hace falta tener instalado. */
function CircuitCard({ preset }: { preset: CircuitPreset }) {
  const commit = useProjectStore((s) => s.commit);
  const { requires } = preset;
  return (
    <div className="stack">
      <img className="preset-preview" src={presetAssets(preset.id).preview} alt={`Trazado de ${preset.name}`} />
      <p className="panel-text">
        <strong>{preset.name}</strong> · {preset.description}
      </p>
      <p className="muted panel-text">
        Delimita el área donde quieras dentro del circuito. Al exportar, la pista carga el circuito instalado en AC
        (<code>content/tracks/{preset.acTrack}</code>) y los conos y líneas se apoyan en su suelo.
        {' '}Requiere: {requires.url ? <a href={requires.url} target="_blank" rel="noreferrer">{requires.name}</a> : requires.name} ({requires.author}).
        {requires.bundled && <> Está en el repositorio: <code>{requires.bundled}</code> (descomprímelo en <code>content/tracks</code>).</>}
      </p>
      <button className="btn btn-sm" onClick={() => commit(actions.clearPreset)}>
        Pasar a mapa libre
      </button>
    </div>
  );
}

function AreaPanel() {
  const scene = useScene();
  const { areaMode, set } = useEditorStore();
  const commit = useProjectStore((s) => s.commit);
  const presetId = useProjectStore((s) => s.project.preset);
  const preset = presetById(presetId);
  if (preset?.kind === 'scene' && scene) return <PresetAreaPanel presetId={preset.id} />;
  const circuit = preset?.kind === 'circuit' ? <CircuitCard preset={preset} /> : null;
  if (scene) {
    const xs = scene.area.map((p) => p.x);
    const ys = scene.area.map((p) => p.y);
    return (
      <div className="stack">
        {circuit}
        <p className="muted panel-text">
          Área de {Math.round(Math.max(...xs) - Math.min(...xs))} × {Math.round(Math.max(...ys) - Math.min(...ys))} m. Las herramientas trabajan dentro de ella.
        </p>
        <button
          className="btn btn-danger"
          onClick={() =>
            window.confirm('Se borrará el área y todo lo que contiene (puedes deshacerlo con Ctrl+Z). ¿Continuar?') &&
            commit((p) => ({ ...createEmptyProject(), name: p.name, preset: presetById(p.preset)?.kind === 'circuit' ? p.preset : null }))
          }
        >
          <TrashIcon size={16} /> Borrar área y empezar de nuevo
        </button>
      </div>
    );
  }
  return (
    <div className="stack">
      {circuit}
      <Field label="Forma">
        <div className="segmented">
          <button aria-pressed={areaMode === 'polygon'} onClick={() => set({ areaMode: 'polygon' })}>Polígono</button>
          <button aria-pressed={areaMode === 'rectangle'} onClick={() => set({ areaMode: 'rectangle' })}>Rectángulo</button>
        </div>
      </Field>
    </div>
  );
}

const TRACK_MODES: ReadonlyArray<{ id: TrackMode; label: string }> = [
  { id: 'points', label: 'Puntos' },
  { id: 'bezier', label: 'Bézier' },
  { id: 'freehand', label: 'Mano alzada' },
];

function TrackPanel() {
  const scene = useScene();
  const track = useProjectStore((s) => s.project.track);
  const presetId = useProjectStore((s) => s.project.preset);
  const commit = useProjectStore((s) => s.commit);
  const { trackMode, set } = useEditorStore();
  const widths = track.anchors.map((a) => a.widthLeft + a.widthRight);
  const width = widths.length ? Math.max(...widths) : 3;
  return (
    <div className="stack">
      <Field label="Modo de trazado">
        <div className="segmented">
          {TRACK_MODES.map((m) => (
            <button key={m.id} aria-pressed={trackMode === m.id} onClick={() => set({ trackMode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Ancho de pista (m)">
        <NumberInput value={width} min={1} max={30} step={0.5} onCommit={(v) => commit((p) => actions.setTrackWidth(p, v))} />
      </Field>
      <Toggle label="Ancho simétrico" checked={track.symmetric} onChange={(v) => commit((p) => actions.setSymmetric(p, v))} />
      <Toggle label="Circuito cerrado" checked={track.closed} onChange={(v) => commit((p) => actions.setTrackOptions(p, { closed: v }))} />
      <Toggle label="Conos automáticos" checked={track.autoCones} onChange={(v) => commit((p) => actions.setTrackOptions(p, { autoCones: v }))} />
      {track.autoCones && (
        <Field label="Separación entre conos (m)">
          <NumberInput value={track.coneSpacing} min={1} max={50} step={0.5} onCommit={(v) => commit((p) => actions.setTrackOptions(p, { coneSpacing: v }))} />
        </Field>
      )}
      {scene?.track && (
        <p className="muted panel-text">
          {Math.round(scene.track.length)} m · {track.anchors.length} puntos · {scene.autoCones.length} conos automáticos
        </p>
      )}
      {presetId && (
        <p className="muted panel-text">
          Con un preset no se genera asfalto: se conduce sobre el suelo real del escenario 3D o del circuito y los conos marcan el trazado.
        </p>
      )}
      <div className="row">
        <button className="btn btn-sm" disabled={track.anchors.length < 2} onClick={() => commit(actions.reverseTrack)}>
          Invertir sentido
        </button>
        <button
          className="btn btn-sm btn-danger"
          disabled={!track.anchors.length}
          onClick={() => window.confirm('¿Borrar todo el trazado?') && commit(actions.clearTrack)}
        >
          <TrashIcon size={14} /> Borrar trazado
        </button>
      </div>
    </div>
  );
}

function ConesPanel() {
  const { coneColor, set } = useEditorStore();
  const cones = useProjectStore((s) => s.project.cones);
  const collidable = useProjectStore((s) => s.project.conesCollidable);
  const commit = useProjectStore((s) => s.commit);
  return (
    <div className="stack">
      <Field label="Color">
        <div className="cone-picker">
          {CONE_COLORS.map((c) => (
            <button key={c} aria-pressed={coneColor === c} onClick={() => set({ coneColor: c })}>
              <span className="swatch" style={{ background: CONE_SPECS[c].mapColor, width: c === 'orangeBig' ? 16 : 12, height: c === 'orangeBig' ? 16 : 12 }} />
              {CONE_SPECS[c].label}
            </button>
          ))}
        </div>
      </Field>
      <Toggle label="Hitbox (colisión cuadrada)" checked={collidable} onChange={(v) => commit((p) => actions.setConesCollidable(p, v))} />
      <p className="muted panel-text">
        {collidable ? 'Los conos son sólidos: el coche choca con una caja del tamaño de su base.' : 'Los conos se pueden atravesar.'} Afecta a
        todos los conos, también a los automáticos.
      </p>
      <button className="btn btn-sm btn-danger" disabled={!cones.length} onClick={() => commit(actions.clearCones)}>
        <TrashIcon size={14} /> Quitar {cones.length} conos manuales
      </button>
    </div>
  );
}

function GatesPanel({ kind }: { kind: 'startFinish' | 'sectors' }) {
  const project = useProjectStore((s) => s.project);
  const commit = useProjectStore((s) => s.commit);
  const scene = useScene();
  if (kind === 'startFinish') {
    return (
      <div className="stack">
        <p className="muted panel-text">
          {project.startFinish
            ? 'Línea colocada. Haz clic de nuevo para moverla. La flecha indica el sentido de la marcha.'
            : 'Necesaria para exportar: define la parrilla, los boxes y el cronometraje por vuelta.'}
        </p>
        {project.startFinish && (
          <button className="btn btn-sm btn-danger" onClick={() => commit(actions.removeStartFinish)}>
            <TrashIcon size={14} /> Quitar salida/meta
          </button>
        )}
      </div>
    );
  }
  const ordered = scene?.sectors ?? [];
  return (
    <div className="stack">
      <p className="muted panel-text">Cada línea divide la vuelta en un sector más (se numeran por su posición desde la salida).</p>
      {ordered.length > 0 && (
        <ul className="sector-list">
          {ordered.map((s, i) => (
            <li key={s.id}>
              <span>Fin del sector {i + 1}</span>
              <button className="btn btn-icon btn-sm" title="Quitar" onClick={() => commit((p) => actions.removeSector(p, s.id))}>
                <CloseIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SurfacePanel() {
  const { surfaceBrush, selectedZoneId, set } = useEditorStore();
  const project = useProjectStore((s) => s.project);
  const commit = useProjectStore((s) => s.commit);
  const selected = project.zones.find((z) => z.id === selectedZoneId);
  const picker = (value: string, onPick: (t: (typeof SURFACE_TYPES)[number]) => void) => (
    <div className="segmented">
      {SURFACE_TYPES.map((t) => (
        <button key={t} aria-pressed={value === t} onClick={() => onPick(t)}>
          <span className="swatch" style={{ background: SURFACES[t].mapColor }} />
          {SURFACES[t].label}
        </button>
      ))}
    </div>
  );
  return (
    <div className="stack">
      <Field label="Suelo a dibujar">{picker(surfaceBrush, (t) => set({ surfaceBrush: t }))}</Field>
      <Field label="Suelo base del área">{picker(project.baseSurface, (t) => commit((p) => actions.setBaseSurface(p, t)))}</Field>
      {selected && (
        <Field label="Zona seleccionada">
          {picker(selected.type, (t) => commit((p) => actions.setZoneType(p, selected.id, t)))}
          <button
            className="btn btn-sm btn-danger"
            onClick={() => {
              commit((p) => actions.removeZone(p, selected.id));
              set({ selectedZoneId: null });
            }}
          >
            <TrashIcon size={14} /> Borrar zona
          </button>
        </Field>
      )}
      <p className="muted panel-text">
        La pista del Track creator siempre es asfalto. Fricción: asfalto {SURFACES.asphalt.physics.friction}, césped {SURFACES.grass.physics.friction}, grava{' '}
        {SURFACES.gravel.physics.friction} (valores de las pistas de Kunos).
      </p>
    </div>
  );
}

/** Diámetros del Brush (m). */
const BRUSH_MIN_M = 0.5;
const BRUSH_MAX_M = 12;
/** Radios del Desnivelador (m). */
const RELIEF_MIN_RADIUS_M = 0.5;
const RELIEF_MAX_RADIUS_M = 15;

/** Alterna el fondo del mapa entre el satélite y la vista topográfica a color. */
function MapViewToggle() {
  const { mapView, set } = useEditorStore();
  const topo = mapView === 'topo';
  return (
    <button className={`btn btn-sm ${topo ? 'btn-primary' : ''}`} aria-pressed={topo} onClick={() => set({ mapView: topo ? 'satellite' : 'topo' })}>
      {topo ? 'Volver a la vista satélite' : 'Vista topográfica'}
    </button>
  );
}

function ReliefPanel() {
  const { reliefDirection, reliefRadius, set } = useEditorStore();
  const strokes = useProjectStore((s) => s.project.relief.length);
  const onPreset = useProjectStore((s) => s.project.preset) !== null;
  const commit = useProjectStore((s) => s.commit);
  return (
    <div className="stack">
      <Field label="Desnivel">
        <div className="segmented">
          <button aria-pressed={reliefDirection === 'raise'} onClick={() => set({ reliefDirection: 'raise' })}>Positivo (subir)</button>
          <button aria-pressed={reliefDirection === 'lower'} onClick={() => set({ reliefDirection: 'lower' })}>Negativo (bajar)</button>
        </div>
      </Field>
      <Field label={`Radio: ${reliefRadius.toFixed(1)} m`}>
        <input
          className="range"
          type="range"
          min={RELIEF_MIN_RADIUS_M}
          max={RELIEF_MAX_RADIUS_M}
          step={0.5}
          value={reliefRadius}
          onChange={(e) => set({ reliefRadius: Number(e.target.value) })}
          aria-label="Radio del Desnivelador (m)"
        />
      </Field>
      <MapViewToggle />
      <p className="muted panel-text">
        Cada pasada sube o baja {RELIEF_STEP_M * 100} cm en el centro y se difumina hacia el borde; repasar acumula. Hacia abajo, como mucho{' '}
        {Math.abs(RELIEF_MIN_M).toLocaleString('es-ES')} m; hacia arriba no hay límite. Conos, líneas y coches siguen el nuevo suelo.
        {onPreset && ' En escenarios 3D y circuitos de AC solo se puede subir: lo que baje de su suelo se ignora.'}
      </p>
      <button className="btn btn-sm btn-danger" disabled={!strokes} onClick={() => commit(actions.clearRelief)}>
        <TrashIcon size={14} /> Quitar todos los desniveles ({strokes})
      </button>
    </div>
  );
}

function BrushPanel() {
  const { brushMaterial, brushSize, brushMode, set } = useEditorStore();
  const strokes = useProjectStore((s) => s.project.dirt.length);
  const commit = useProjectStore((s) => s.commit);
  const levels = DIRT_SPECS[brushMaterial].levels.map((l) => l.friction.toLocaleString('es-ES')).join(' / ');
  return (
    <div className="stack">
      <Field label="Modo">
        <div className="segmented">
          <button aria-pressed={brushMode === 'paint'} onClick={() => set({ brushMode: 'paint' })}>Pintar</button>
          <button aria-pressed={brushMode === 'erase'} onClick={() => set({ brushMode: 'erase' })}>Borrar</button>
        </div>
      </Field>
      <Field label="Material">
        <div className="segmented">
          {DIRT_MATERIALS.map((m) => (
            <button key={m} aria-pressed={brushMaterial === m} onClick={() => set({ brushMaterial: m })}>
              <span className="swatch" style={{ background: DIRT_SPECS[m].mapColor }} />
              {DIRT_SPECS[m].label}
            </button>
          ))}
        </div>
      </Field>
      <Field label={`Tamaño: ${brushSize.toFixed(1)} m`}>
        <input
          className="range"
          type="range"
          min={BRUSH_MIN_M}
          max={BRUSH_MAX_M}
          step={0.5}
          value={brushSize}
          onChange={(e) => set({ brushSize: Number(e.target.value) })}
          aria-label="Tamaño del Brush (m)"
        />
      </Field>
      <p className="muted panel-text">
        Cada pasada deja una ligera capa que se difumina hacia el borde; repasar la misma zona la ensucia más. En AC reduce el agarre
        (fricción {levels} según lo cargada que esté, frente a {SURFACES.asphalt.physics.friction} del asfalto) y ensucia los neumáticos.
      </p>
      <MapViewToggle />
      <button className="btn btn-sm btn-danger" disabled={!strokes} onClick={() => commit(actions.clearDirt)}>
        <TrashIcon size={14} /> Quitar toda la suciedad ({strokes})
      </button>
    </div>
  );
}

export function ToolPanel() {
  const tool = useEditorStore((s) => s.tool);
  const collapsed = useEditorStore((s) => s.toolbarCollapsed);
  const setEditor = useEditorStore((s) => s.set);
  if (!tool) return null;
  const entry = TOOLS.find((t) => t.id === tool)!;
  const body = {
    area: <AreaPanel />,
    track: <TrackPanel />,
    cones: <ConesPanel />,
    startFinish: <GatesPanel kind="startFinish" />,
    sectors: <GatesPanel kind="sectors" />,
    surface: <SurfacePanel />,
    brush: <BrushPanel />,
    relief: <ReliefPanel />,
  }[tool];
  return (
    <aside className={`tool-panel ${collapsed ? 'tool-panel-shifted' : ''}`}>
      <div className="tool-panel-header">
        <entry.Icon size={18} />
        <strong>{entry.label}</strong>
        <button className="btn btn-icon btn-sm tool-panel-close" onClick={() => setEditor({ tool: null })} title="Cerrar">
          <CloseIcon size={14} />
        </button>
      </div>
      {body}
    </aside>
  );
}
