import L from 'leaflet';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMap } from 'react-leaflet';
import { useEditorStore } from '../../state/editorStore';
import { SearchIcon } from '../icons';

const COORDS = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/;

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

/** Buscador de lugares (OpenStreetMap Nominatim) o coordenadas «lat, lng». */
export function SearchBox() {
  const map = useMap();
  const notify = useEditorStore((s) => s.notify);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    L.DomEvent.disableClickPropagation(ref.current);
    L.DomEvent.disableScrollPropagation(ref.current);
  }, []);

  async function search(e: FormEvent): Promise<void> {
    e.preventDefault();
    const coords = COORDS.exec(query);
    if (coords) {
      map.flyTo([Number(coords[1]), Number(coords[2])], 18);
      return;
    }
    if (!query.trim()) return;
    setBusy(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
      const [hit] = (await (await fetch(url, { headers: { 'Accept-Language': 'es' } })).json()) as NominatimResult[];
      if (hit) map.flyTo([Number(hit.lat), Number(hit.lon)], 17);
      else notify(`No se encontró «${query}»`, 'error');
    } catch {
      notify('No se pudo conectar con el buscador', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={ref} className="searchbox" onSubmit={search}>
      <SearchIcon size={16} />
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar lugar o «lat, lng»" aria-label="Buscar lugar" />
      <button className="btn btn-sm btn-primary" disabled={busy}>
        {busy ? '…' : 'Ir'}
      </button>
    </form>
  );
}
