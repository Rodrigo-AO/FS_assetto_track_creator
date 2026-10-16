import { MapContainer, Pane, TileLayer, ZoomControl } from 'react-leaflet';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { AreaMaskLayer } from './layers/AreaMaskLayer';
import { ConesLayer } from './layers/ConesLayer';
import { GatesLayer } from './layers/GatesLayer';
import { SurfaceZonesLayer } from './layers/SurfaceZonesLayer';
import { TrackLayer } from './layers/TrackLayer';
import { PANES, toL, type LPoint } from './leafletUtils';
import { MapController } from './MapController';
import { SearchBox } from './SearchBox';
import { AreaTool } from './tools/AreaTool';
import { ConeTool } from './tools/ConeTool';
import { GateTool } from './tools/GateTool';
import { SurfaceTool } from './tools/SurfaceTool';
import { TrackTool } from './tools/TrackTool';

/** Vista inicial por defecto: Sevilla (sede de ARUS). */
const DEFAULT_CENTER: LPoint = [37.4125, -6.0045];
const DEFAULT_ZOOM = 16;

export function MapView() {
  const tool = useEditorStore((s) => s.tool);
  const area = useProjectStore((s) => s.project.area);
  const initialBounds = area && area.length >= 3 ? area.map(toL) : undefined;

  return (
    <div className="map-wrap">
      <MapContainer
        className="map"
        center={initialBounds ? undefined : DEFAULT_CENTER}
        zoom={initialBounds ? undefined : DEFAULT_ZOOM}
        bounds={initialBounds}
        boundsOptions={{ padding: [80, 80] }}
        maxZoom={21}
        zoomControl={false}
        doubleClickZoom={false}
        attributionControl
      >
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="Imágenes &copy; Esri, Maxar, Earthstar Geographics"
          maxNativeZoom={19}
          maxZoom={21}
        />
        {Object.entries(PANES).map(([name, zIndex]) => (
          <Pane key={name} name={name} style={{ zIndex }} />
        ))}
        <ZoomControl position="bottomright" />
        <MapController />

        <AreaMaskLayer />
        {tool !== 'surface' && <SurfaceZonesLayer />}
        <TrackLayer />
        <GatesLayer />
        <ConesLayer />

        {tool === 'area' && <AreaTool />}
        {tool === 'track' && <TrackTool />}
        {tool === 'cones' && <ConeTool />}
        {(tool === 'startFinish' || tool === 'sectors') && <GateTool kind={tool} />}
        {tool === 'surface' && <SurfaceTool />}
        <SearchBox />
      </MapContainer>
    </div>
  );
}
