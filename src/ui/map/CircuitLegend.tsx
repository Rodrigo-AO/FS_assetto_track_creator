import { SURFACE_CLASS_COLORS, SURFACE_CLASS_LABELS, SURFACE_CLASSES } from '../../domain/presets/circuit';
import { circuitPresetById } from '../../domain/presets/presets';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { useCircuitCheck, useCircuitSurfaces } from '../editor/useCircuitSurfaces';

/**
 * Leyenda del circuito de AC (esquina inferior izquierda del mapa): activa la capa de superficies
 * y muestra en vivo cuánto del trazado y de los conos cae sobre el pavimento del circuito.
 */
export function CircuitLegend() {
  const circuit = circuitPresetById(useProjectStore((s) => s.project.preset));
  const show = useEditorStore((s) => s.showCircuitLayer);
  const set = useEditorStore((s) => s.set);
  const { surfaces, error } = useCircuitSurfaces();
  const check = useCircuitCheck();
  if (!circuit) return null;

  const percent = check?.trackOnPaved === null || !check ? null : Math.round(check.trackOnPaved * 100);
  const trackOk = percent === null || percent === 100;
  return (
    <div className="circuit-legend" role="region" aria-label="Superficies del circuito de AC">
      <label className="toggle">
        <span>Superficies de AC</span>
        <input type="checkbox" checked={show} onChange={(e) => set({ showCircuitLayer: e.target.checked })} disabled={!surfaces} />
      </label>
      {error && <p className="circuit-legend-error">No se pudo leer el circuito: {error}</p>}
      {!error && !surfaces && <p className="muted">Leyendo el circuito instalado…</p>}
      {surfaces && show && (
        <ul className="circuit-legend-items">
          {SURFACE_CLASSES.map((c) => (
            <li key={c}>
              <span className="circuit-swatch" style={{ background: `rgb(${SURFACE_CLASS_COLORS[c].join(',')})` }} />
              {SURFACE_CLASS_LABELS[c]}
            </li>
          ))}
        </ul>
      )}
      {check && (percent !== null || check.cones > 0) && (
        <div className={`circuit-check ${trackOk && check.conesOff === 0 ? 'circuit-check-ok' : 'circuit-check-bad'}`}>
          {percent !== null && <span>Trazado sobre pavimento de AC: <strong>{percent} %</strong></span>}
          {check.cones > 0 && (
            <span>
              Conos fuera (césped, grava o sin suelo): <strong>{check.conesOff}</strong> de {check.cones}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
