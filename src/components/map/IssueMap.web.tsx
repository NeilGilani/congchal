import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { T } from '@/components/Typography';
import { colors, space } from '@/constants/theme';

import type { IssueMapProps } from './IssueMap';

/**
 * The interactive map uses MapLibre Native, which only runs in the iOS and
 * Android apps. In a browser preview the list below the map shows the same
 * issues.
 */
export const IssueMap = ({ issues }: IssueMapProps) => (
  <View style={styles.root}>
    <Icon name="map" size={28} color={colors.textSecondary} />
    <T variant="callout" tone="secondary" align="center">
      The interactive map is available in the iOS and Android app. {issues.length} issue{issues.length === 1 ? '' : 's'} listed below.
    </T>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl, backgroundColor: colors.surface },
});
