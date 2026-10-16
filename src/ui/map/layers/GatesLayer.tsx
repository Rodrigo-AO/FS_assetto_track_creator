import { Polyline, Tooltip } from 'react-leaflet';
import { add, scale, sub } from '../../../domain/geometry/vec2';
import type { Scene } from '../../../domain/project/scene';
import { gateCenter, gateForward, type LocalGate } from '../../../domain/track/gates';
import { useScene } from '../../editor/sceneContext';
import { localToL } from '../leafletUtils';

/** Flecha de 4 m desde el centro de la línea en el sentido de la marcha. */
function arrow(scene: Scene, gate: LocalGate) {
  const c = gateCenter(gate);
  const f = gateForward(gate);
  const tip = add(c, scale(f, 4));
  const side = scale({ x: -f.y, y: f.x }, 1);
  const back = sub(tip, scale(f, 1.4));
  return [
    [localToL(scene, c), localToL(scene, tip)],
    [localToL(scene, add(back, side)), localToL(scene, tip), localToL(scene, sub(back, side))],
  ];
}

export function GateShape({ scene, gate, label, kind }: { scene: Scene; gate: LocalGate; label: string; kind: 'startFinish' | 'sector' }) {
  const line = [localToL(scene, gate.left), localToL(scene, gate.right)];
  const color = kind === 'startFinish' ? '#FFFFFF' : '#4BB8E8';
  return (
    <>
      <Polyline pane="gates" positions={line} interactive={false} pathOptions={{ color, weight: 5 }} />
      {kind === 'startFinish' && <Polyline pane="gates" positions={line} interactive={false} pathOptions={{ color: '#000000', weight: 5, dashArray: '5 5' }} />}
      <Polyline pane="gates" positions={arrow(scene, gate)} interactive={false} pathOptions={{ color, weight: 2.5 }}>
        <Tooltip permanent direction="top" offset={[0, -6]} className="gate-label">
          {label}
        </Tooltip>
      </Polyline>
    </>
  );
}

export function GatesLayer() {
  const scene = useScene();
  if (!scene) return null;
  return (
    <>
      {scene.startFinish && <GateShape scene={scene} gate={scene.startFinish} label="Salida / Meta" kind="startFinish" />}
      {scene.sectors.map((s, i) => (
        <GateShape key={s.id} scene={scene} gate={s.gate} label={`S${i + 1}`} kind="sector" />
      ))}
    </>
  );
}
