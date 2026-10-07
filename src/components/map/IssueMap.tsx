import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  UserLocation,
  type CameraRef,
  type GeoJSONSourceRef,
} from '@maplibre/maplibre-react-native';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { T } from '@/components/Typography';
import { appConfig } from '@/constants/config';
import { colors, space } from '@/constants/theme';
import { toFeatureCollection, type MapIssue } from '@/services/civic/mapIssues';
import type { LatLng } from '@/utils/geo';

export interface IssueMapProps {
  issues: readonly MapIssue[];
  center?: LatLng;
  showUser: boolean;
  onSelect: (issue: MapIssue | undefined) => void;
}

/**
 * MapLibre map with native clustering (hundreds of points stay fast and
 * legible). Clusters zoom in on tap; single issues open a summary card.
 * Marker color encodes severity/status, and every marker also has a text
 * equivalent in the list below the map.
 */
export const IssueMap = ({ issues, center, showUser, onSelect }: IssueMapProps) => {
  const cameraRef = useRef<CameraRef>(null);
  const sourceRef = useRef<GeoJSONSourceRef>(null);
  const [failed, setFailed] = useState(false);
  const data = useMemo(() => toFeatureCollection(issues), [issues]);
  const byId = useMemo(() => new globalThis.Map(issues.map((i) => [i.id, i])), [issues]);

  return (
    <View style={styles.root} accessibilityLabel={`Map with ${issues.length} issues`}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={appConfig.mapStyleUrl}
        attribution
        logo={false}
        compass
        scaleBar={false}
        onDidFailLoadingMap={() => setFailed(true)}
        onPress={() => onSelect(undefined)}
      >
        <Camera
          ref={cameraRef}
          initialViewState={center ? { center: [center.longitude, center.latitude], zoom: 15 } : { center: [-98.5795, 39.8283], zoom: 3 }}
          maxZoom={19}
        />
        {showUser ? <UserLocation accuracy animated /> : null}
        <GeoJSONSource
          id="issues"
          ref={sourceRef}
          data={data}
          cluster
          clusterRadius={44}
          clusterMaxZoom={16}
          onPress={(e) => {
            e.stopPropagation();
            const f = e.nativeEvent.features[0];
            if (!f) return;
            const props = (f.properties ?? {}) as { cluster?: boolean; cluster_id?: number; id?: string };
            if (props.cluster && props.cluster_id !== undefined && f.geometry.type === 'Point') {
              const [lng, lat] = f.geometry.coordinates as [number, number];
              void sourceRef.current?.getClusterExpansionZoom(props.cluster_id).then((zoom) => {
                cameraRef.current?.easeTo({ center: [lng, lat], zoom: Math.min(zoom + 0.5, 18), duration: 400 });
              });
              return;
            }
            if (props.id) onSelect(byId.get(props.id));
          }}
        >
          <Layer
            id="cluster-circles"
            type="circle"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': colors.surfaceRaised,
              'circle-stroke-color': colors.text,
              'circle-stroke-width': 1.5,
              'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26],
            }}
          />
          <Layer
            id="cluster-count"
            type="symbol"
            filter={['has', 'point_count']}
            layout={{ 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-allow-overlap': true }}
            paint={{ 'text-color': colors.text }}
          />
          <Layer
            id="issue-points"
            type="circle"
            filter={['!', ['has', 'point_count']]}
            paint={{
              'circle-radius': ['case', ['==', ['get', 'kind'], 'local'], 9, 7],
              'circle-color': [
                'case',
                ['==', ['get', 'open'], 0],
                colors.positive,
                ['==', ['get', 'sev'], 'high'],
                colors.critical,
                ['==', ['get', 'sev'], 'moderate'],
                colors.caution,
                ['==', ['get', 'kind'], 'public'],
                colors.concern,
                colors.accent,
              ],
              'circle-stroke-color': ['case', ['==', ['get', 'kind'], 'local'], colors.white, colors.bg],
              'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'local'], 2.5, 1.5],
            }}
          />
        </GeoJSONSource>
      </Map>
      {failed ? (
        <View style={styles.failed}>
          <T variant="callout" align="center">
            The map couldn’t load. You may be offline. The list below still shows every issue.
          </T>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  failed: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: colors.surface },
});
