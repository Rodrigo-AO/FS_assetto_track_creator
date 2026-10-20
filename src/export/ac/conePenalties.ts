/**
 * Penalización de 2 s por cono tocado cuando los conos no tienen colisión (se atraviesan). AC no
 * tiene penalizaciones de tiempo ni CSP deja cambiar el tiempo oficial de la vuelta, así que un
 * script de pista de Custom Shaders Patch (`[SCRIPT_…]` en `extension/ext_config.ini`) detecta los
 * conos que toca el coche, avisa en pantalla y, al cerrar la vuelta, muestra el tiempo con la
 * penalización. Sin CSP la pista funciona igual, sin penalizaciones.
 */
import { CONE_SPECS } from '../../domain/cones/coneSpecs';
import type { Vec2 } from '../../domain/geometry/vec2';
import type { ConeColor } from '../../domain/project/types';
import { toAc } from './meshes';

export const CONE_PENALTY_S = 2;
export const CONE_SCRIPT_FILE = 'extension/atc_cones.lua';
export const EXT_CONFIG_FILE = 'extension/ext_config.ini';

export interface PenaltyCone {
  readonly position: Vec2;
  readonly color: ConeColor;
}

/** Archivos del script de penalizaciones (rutas relativas a la carpeta de la pista). */
export function conePenaltyFiles(cones: readonly PenaltyCone[]): Record<string, string> {
  if (!cones.length) return {};
  const rows = cones.map((c) => {
    const [x, , z] = toAc(c.position, 0);
    return `  {${x.toFixed(3)}, ${z.toFixed(3)}, ${(CONE_SPECS[c.color].baseSize / 2).toFixed(3)}},`;
  });
  return {
    [EXT_CONFIG_FILE]: [
      '; Assetto Track Creator: penalización por cono tocado (necesita Custom Shaders Patch).',
      '[SCRIPT_0]',
      'SCRIPT = atc_cones.lua',
      '',
    ].join('\n'),
    [CONE_SCRIPT_FILE]: [`-- Conos del circuito: x, z (coordenadas de AC) y radio de la base (m).`, 'local CONES = {', ...rows, '}', '', LUA_LOGIC].join('\n'),
  };
}

/** Lógica del script (Lua de CSP, `ac_track_script`). */
const LUA_LOGIC = `local PENALTY_S = ${CONE_PENALTY_S}
-- Solo se miran los conos a menos de esta distancia del coche (m).
local NEAR_M = 5
-- Carrocería por delante del eje delantero y por detrás del trasero (m): la huella del coche se
-- calcula con las ruedas, que valen para cualquier coche.
local FRONT_OVERHANG_M = 0.6
local REAR_OVERHANG_M = 0.4

local touched = {}     -- conos tocados en la vuelta actual (índice -> true)
local count = 0        -- conos tocados en la vuelta actual
local best = nil       -- mejor vuelta con penalización (ms)
local started = false  -- el primer cruce de meta (desde boxes o la parrilla) solo empieza la vuelta

local function reset()
  touched = {}
  count = 0
end

local function plural(n, one, many)
  return n .. ' ' .. (n == 1 and one or many)
end

-- Huella del coche en planta: rectángulo alineado con el coche que cubre las cuatro ruedas, más
-- los voladizos. Devuelve su eje (adelante y lateral) y sus límites.
local function footprint(car)
  local fx, fz = car.look.x, car.look.z
  local len = math.sqrt(fx * fx + fz * fz)
  if len < 1e-6 then return nil end
  fx, fz = fx / len, fz / len
  local sx, sz = -fz, fx
  local l0, l1, s0, s1 = math.huge, -math.huge, math.huge, -math.huge
  for i = 0, 3 do
    local w = car.wheels[i]
    local dx = w.contactPoint.x - car.position.x
    local dz = w.contactPoint.z - car.position.z
    local l = dx * fx + dz * fz
    local s = dx * sx + dz * sz
    local hw = w.tyreWidth * 0.5
    l0, l1 = math.min(l0, l), math.max(l1, l)
    s0, s1 = math.min(s0, s - hw), math.max(s1, s + hw)
  end
  return { fx = fx, fz = fz, sx = sx, sz = sz, l0 = l0 - REAR_OVERHANG_M, l1 = l1 + FRONT_OVERHANG_M, s0 = s0, s1 = s1 }
end

local function touches(car, box, cone)
  local dx = cone[1] - car.position.x
  local dz = cone[2] - car.position.z
  if dx * dx + dz * dz > NEAR_M * NEAR_M then return false end
  local l = dx * box.fx + dz * box.fz
  local s = dx * box.sx + dz * box.sz
  local r = cone[3]
  return l > box.l0 - r and l < box.l1 + r and s > box.s0 - r and s < box.s1 + r
end

function script.update(dt)
  local car = ac.getCar(0)
  if not car or car.isInPit then return end
  local box = footprint(car)
  if not box then return end
  for i = 1, #CONES do
    if not touched[i] and touches(car, box, CONES[i]) then
      touched[i] = true
      count = count + 1
      ac.setMessage('Cono tocado: +' .. PENALTY_S .. ' s', plural(count, 'cono', 'conos') .. ' en esta vuelta (+' .. count * PENALTY_S .. ' s)', 'illegal', 3)
    end
  end
end

ac.onLapCompleted(0, function (carIndex, lapTime, valid, cuts, lapCount)
  if not started then
    started = true
    reset()
    return
  end
  local total = lapTime + count * PENALTY_S * 1000
  if best == nil or total < best then best = total end
  if count > 0 then
    ac.setMessage('Vuelta ' .. ac.lapTimeToString(lapTime) .. ' + ' .. count * PENALTY_S .. ' s = ' .. ac.lapTimeToString(total),
      plural(count, 'cono tocado', 'conos tocados') .. ' · mejor con penalización: ' .. ac.lapTimeToString(best), 'illegal', 8)
  else
    ac.setMessage('Vuelta limpia: ' .. ac.lapTimeToString(lapTime), 'Sin conos tocados · mejor con penalización: ' .. ac.lapTimeToString(best), nil, 6)
  end
  reset()
end)

-- Volver a boxes o reiniciar la sesión empieza de cero.
ac.onCarJumped(0, function () reset(); started = false end)
ac.onSessionStart(function () reset(); started = false; best = nil end)
`;
