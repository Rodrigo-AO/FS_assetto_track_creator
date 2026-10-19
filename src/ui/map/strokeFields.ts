import type { LatLng } from '../../domain/geo/projection';
import { strokeField, type FieldStroke, type StrokeField } from '../../domain/strokes/strokeField';
import type { TrackProject } from '../../domain/project/types';

interface SourceStroke {
  readonly radius: number;
  readonly points: readonly LatLng[];
}

/** Campos ya calculados, por pasada del proyecto; valen mientras no cambie el plano local. */
let cache: { area: TrackProject['area']; preset: string | null; fields: WeakMap<SourceStroke, StrokeField> } | null = null;

/**
 * Devuelve `fieldOf` para los rasterizadores del Brush y del Desnivelador: reutiliza el campo de
 * cada pasada que no ha cambiado, así que mientras se pinta solo se recalcula la pasada en curso.
 * `sources[i]` es la pasada del proyecto (lat/lng) de `locals[i]`.
 */
export function cachedFieldOf<L extends FieldStroke>(
  project: Pick<TrackProject, 'area' | 'preset'>,
  sources: readonly SourceStroke[],
  locals: readonly L[],
): (stroke: L) => StrokeField {
  // El plano local depende del área y del preset: si cambian, los campos ya no sirven.
  if (!cache || cache.area !== project.area || cache.preset !== project.preset) {
    cache = { area: project.area, preset: project.preset, fields: new WeakMap() };
  }
  const { fields } = cache;
  const sourceOf = new Map<L, SourceStroke>(locals.map((l, i) => [l, sources[i]]));
  return (stroke) => {
    const source = sourceOf.get(stroke);
    if (!source) return strokeField(stroke);
    let field = fields.get(source);
    if (!field) {
      field = strokeField(stroke);
      fields.set(source, field);
    }
    return field;
  };
}
