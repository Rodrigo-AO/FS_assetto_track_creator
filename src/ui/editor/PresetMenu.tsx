import { useEffect, useRef, useState } from 'react';
import { applyPreset, clearPreset } from '../../domain/project/actions';
import { PRESETS, presetAssets, presetById, type PresetSite } from '../../domain/presets/presets';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { ChevronDownIcon, MapPinIcon } from '../icons';
import { fetchCircuitStatus } from './presetService';

const SCENES = PRESETS.filter((p) => p.kind === 'scene');
const CIRCUITS = PRESETS.filter((p) => p.kind === 'circuit');

/** Desplegable «Presets» de la cabecera: escenarios 3D propios y circuitos instalados en AC. */
export function PresetMenu() {
  const project = useProjectStore((s) => s.project);
  const commit = useProjectStore((s) => s.commit);
  const { set, notify } = useEditorStore();
  const fitRequest = useEditorStore((s) => s.fitRequest);
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);
  const current = presetById(project.preset);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    for (const c of CIRCUITS) {
      if (c.kind === 'circuit') fetchCircuitStatus(c).then((ok) => setInstalled((s) => ({ ...s, [c.id]: ok })));
    }
  }, [open]);

  const choose = (preset: PresetSite | null): void => {
    setOpen(false);
    if (preset?.id === project.preset) return;
    if (preset) {
      const hasContent = project.track.anchors.length > 0 || project.cones.length > 0 || project.zones.length > 0;
      const question =
        preset.kind === 'scene'
          ? `El área pasará a ser la de «${preset.name}». El trazado y los conos se conservan (puedes deshacerlo). ¿Continuar?`
          : `Sobre «${preset.name}» delimitarás un área nueva: la actual se descarta. El trazado y los conos se conservan (puedes deshacerlo). ¿Continuar?`;
      if ((hasContent || (preset.kind === 'circuit' && project.area)) && !window.confirm(question)) return;
      commit((p) => applyPreset(p, preset));
      set({ tool: preset.kind === 'scene' ? 'track' : 'area', fitRequest: fitRequest + 1 });
      notify(
        preset.kind === 'scene'
          ? `Preset «${preset.name}»: el escenario 3D se incluirá al exportar.`
          : `«${preset.name}»: delimita el área sobre el circuito. Al exportar se usará el circuito instalado en AC.`,
        'success',
      );
    } else {
      commit(clearPreset);
      notify('Mapa libre: el área vuelve a ser editable.', 'info');
    }
  };

  const card = (p: PresetSite) => (
    <button key={p.id} className="preset-card" role="menuitem" aria-pressed={p.id === project.preset} onClick={() => choose(p)}>
      <img src={presetAssets(p.id).preview} alt="" loading="lazy" />
      <span>
        <strong>{p.name}</strong>
        <small>{p.description}</small>
        {p.kind === 'circuit' && installed[p.id] === false && <small className="preset-missing">No instalado en AC: {p.requires.name}</small>}
      </span>
    </button>
  );

  return (
    <div className="preset-menu" ref={ref}>
      <button className={`btn btn-sm ${current ? 'preset-active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <MapPinIcon size={16} />
        <span className="preset-label">{current ? current.name : 'Presets'}</span>
        <ChevronDownIcon size={14} />
      </button>
      {open && (
        <div className="preset-popover" role="menu">
          <p className="field-label">Ubicaciones con escenario 3D</p>
          {SCENES.map(card)}
          <p className="field-label">Circuitos de Assetto Corsa · área libre</p>
          {CIRCUITS.map(card)}
          <button className="preset-none" onClick={() => choose(null)} disabled={!project.preset}>
            Mapa libre (sin preset)
          </button>
        </div>
      )}
    </div>
  );
}
